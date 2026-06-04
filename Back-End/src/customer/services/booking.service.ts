import prisma from "../../login/lib/prisma";
import { AppError } from "../../shared/utils/app-error.util";
import {
  buildVietQrQuickLink,
  getHotelPaymentAccount,
} from "./payment.service";
import {
  countReservedRooms,
  type BookingRange,
} from "../utils/roomAvailability.util";
import {
  incrementVoucherUsage,
  validateVoucher,
} from "../../shared/services/voucher-validation.service";

type CreateCustomerBookingInput = {
  userId: string;
  hotelId: string;
  roomId: string;
  paymentMethod?: "VIETQR" | "PAY_AT_HOTEL";
  bookingType: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  amount: number;
  durationValue?: number;
  customerName?: string;
  customerPhone?: string;
  voucherCode?: string;
};

const CUSTOMER_BOOKING_TYPE_TO_DB: Record<
  string,
  "hourly" | "overnight" | "daily"
> = {
  "Theo giờ": "hourly",
  "Qua đêm": "overnight",
  "Theo ngày": "daily",
};

const DB_BOOKING_TYPE_TO_CUSTOMER: Record<string, string> = {
  hourly: "Theo giờ",
  overnight: "Qua đêm",
  daily: "Theo ngày",
};

const PAYMENT_WINDOW_MINUTES = 15;
const PAYMENT_GRACE_MINUTES = 5;
const PAYMENT_WINDOW_MS = PAYMENT_WINDOW_MINUTES * 60 * 1000;
const PAYMENT_GRACE_MS = PAYMENT_GRACE_MINUTES * 60 * 1000;
const SUPPORT_EMAIL = "support@stayhub.com";
const SUPPORT_CHATBOX = "Chatbox realtime";
const DEFAULT_ROOM_IMAGE =
  "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800";

const formatDateParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const formatCodeDateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const getPart = (
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) => parts.find((part) => part.type === type)?.value || "";

const formatBookingDate = (date: Date) => {
  const parts = formatDateParts.formatToParts(date);
  return `${getPart(parts, "hour")}:${getPart(parts, "minute")}, ${getPart(parts, "day")}/${getPart(parts, "month")}/${getPart(parts, "year")}`;
};

const getBookingCodePrefix = (date = new Date()) => {
  const parts = formatCodeDateParts.formatToParts(date);
  return `BK${getPart(parts, "year")}${getPart(parts, "month")}${getPart(parts, "day")}`;
};

const parseRequiredDate = (value: string, fieldName: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "VALIDATION_ERROR", {
      userMessage: `${fieldName} không hợp lệ.`,
    });
  }
  return date;
};

const getMoneyText = (amount: number) =>
  `${Math.round(amount).toLocaleString("vi-VN")}đ`;

const getPaymentCode = (bookingCode: string, attemptNo: number) =>
  `PM${bookingCode.replace(/^BK/i, "")}${String(attemptNo).padStart(2, "0")}`;

const getPaymentContent = (bookingCode: string, paymentCode: string) =>
  `${bookingCode} ${paymentCode}`;

const getPaymentDeadlines = (now = new Date()) => ({
  expiresAt: new Date(now.getTime() + PAYMENT_WINDOW_MS),
  graceExpiresAt: new Date(
    now.getTime() + PAYMENT_WINDOW_MS + PAYMENT_GRACE_MS,
  ),
});

const getPaymentPhase = (payment: any, now = new Date()) => {
  if (!payment) return "NONE";
  if (payment.status === "PAID") return "PAID";
  if (["EXPIRED_FINAL", "PAYMENT_NOT_RECORDED"].includes(payment.status))
    return "EXPIRED_FINAL";
  if (payment.status !== "PENDING") return payment.status;

  // PAY_AT_HOTEL payments don't have expiration times
  if (payment.method === "PAY_AT_HOTEL") return "ACTIVE";

  if (now > payment.graceExpiresAt) return "EXPIRED_FINAL";
  if (now > payment.expiresAt) return "GRACE";
  return "ACTIVE";
};

const finalizeExpiredPayment = async (
  client: any,
  payment: any,
  now = new Date(),
) => {
  // Skip finalization for PAY_AT_HOTEL payments (no automatic expiration)
  if (!payment || payment.method === "PAY_AT_HOTEL") {
    return payment;
  }

  if (payment.status !== "PENDING" || now <= payment.graceExpiresAt) {
    return payment;
  }

  return client.payment.update({
    where: { id: payment.id },
    data: {
      status: "EXPIRED_FINAL",
      expiredAt: now,
      failureReason: "NO_VALID_WEBHOOK",
      failureMessage:
        "Không có webhook hợp lệ gửi về backend trong thời gian tự động ghi nhận.",
    },
  });
};

const toPaymentResponse = (payment: any, now = new Date()) => {
  const isPayAtHotel = payment.method === "PAY_AT_HOTEL";

  return {
    id: payment.id,
    method: payment.method,
    paymentCode: isPayAtHotel ? null : payment.paymentCode || null,
    amount: payment.amount,
    content: isPayAtHotel ? null : payment.content || null,
    bankCode: isPayAtHotel ? null : payment.bankCode || null,
    bankName: isPayAtHotel ? null : payment.bankName || null,
    accountNumber: isPayAtHotel ? null : payment.accountNumber || null,
    accountName: isPayAtHotel ? null : payment.accountName || null,
    vietQrUrl: isPayAtHotel ? null : payment.vietQrUrl || null,
    status: payment.status,
    attemptNo: payment.attemptNo || null,
    expiresAt: isPayAtHotel ? null : payment.expiresAt?.toISOString() || null,
    graceExpiresAt: isPayAtHotel
      ? null
      : payment.graceExpiresAt?.toISOString() || null,
    expiredAt: payment.expiredAt?.toISOString() || null,
    paidAt: payment.paidAt?.toISOString() || null,
    failureReason: payment.failureReason || null,
    failureMessage: payment.failureMessage || null,
    phase: getPaymentPhase(payment, now),
  };
};

const getBookingStatusText = (booking: any) => {
  const payment = booking.payments?.[0];

  if (booking.status === "CANCELLED") return "Đã huỷ";
  if (booking.status === "COMPLETED") return "Hoàn thành";
  if (booking.status === "CHECKED_IN") return "Đã nhận phòng";
  if (booking.status === "PAYMENT_PENDING") return "Chờ thanh toán";

  if (booking.status === "CONFIRMED" && payment?.status === "PAID")
    return "Chờ nhận phòng";
  if (payment?.method === "PAY_AT_HOTEL") return "Chờ nhận phòng";
  if (["EXPIRED_FINAL", "PAYMENT_NOT_RECORDED"].includes(payment?.status))
    return "Không ghi nhận thanh toán";
  return "Đang chờ xử lý";
};

const getHotelAddressText = (hotel: any) => {
  if (!hotel?.address) return "Địa chỉ khách sạn đang cập nhật";
  return (
    hotel.address.fullAddress ||
    [
      hotel.address.addressLine,
      hotel.address.ward,
      hotel.address.district,
      hotel.address.city,
      hotel.address.province,
    ]
      .filter(Boolean)
      .join(", ")
  );
};

const getImageUrl = (booking: any) => {
  const roomImage = booking.roomType?.media?.find(
    (item: any) => item.mediaType === "image",
  )?.imageUrl;
  const hotelImage = booking.hotel?.images?.[0]?.imageUrl;
  return roomImage || hotelImage || DEFAULT_ROOM_IMAGE;
};

const normalizeBooking = (booking: any) => {
  const payment = booking.payments?.[0] || null;
  const bookingType = booking.bookingType
    ? DB_BOOKING_TYPE_TO_CUSTOMER[String(booking.bookingType)] ||
      String(booking.bookingType)
    : "Theo giờ";

  return {
    id: booking.id,
    code: booking.bookingCode || booking.id.slice(0, 8).toUpperCase(),
    hotelId: booking.hotelId || booking.propertyId || "",
    hotelName: booking.hotel?.name || booking.property?.name || "Khách sạn",
    hotelAddress:
      getHotelAddressText(booking.hotel) || booking.property?.address,
    hotelImage: booking.hotel?.images?.[0]?.imageUrl || undefined,
    roomId: booking.roomTypeId || booking.roomId || undefined,
    roomName: booking.roomType?.name || booking.room?.name || "STANDARD ROOM",
    roomImage: getImageUrl(booking),
    price: getMoneyText(Number(booking.totalPrice || payment?.amount || 0)),
    bookingType,
    checkIn: formatBookingDate(booking.checkIn),
    checkOut: formatBookingDate(booking.checkOut),
    hours: booking.durationValue ? String(booking.durationValue) : undefined,
    customerName:
      booking.customerName || booking.user?.username || "Khách hàng",
    customerPhone: booking.customerPhone || undefined,
    voucherCode: booking.voucherCode || undefined,
    status: getBookingStatusText(booking),
    paymentMethod: payment?.method || "VIETQR",
    paymentStatus: payment?.status || "PENDING",
    paymentFailureReason: payment?.failureReason || null,
    paymentFailureMessage: payment?.failureMessage || null,
    createdAt: booking.createdAt.toISOString(),
  };
};

const bookingInclude = {
  user: { select: { username: true, email: true } },
  hotel: {
    include: {
      address: true,
      images: {
        orderBy: { sortOrder: "asc" as const },
        take: 1,
      },
    },
  },
  property: true,
  room: true,
  roomType: {
    include: {
      media: {
        where: { mediaType: "image" as const },
        orderBy: { sortOrder: "asc" as const },
        take: 1,
      },
    },
  },
  payments: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
};

const createVietQrPayment = async (
  client: any,
  params: {
    bookingId: string;
    bookingCode: string;
    hotelId: string;
    amount: number;
    attemptNo: number;
  },
) => {
  const now = new Date();
  console.log("[createVietQrPayment] Starting for hotel:", params.hotelId);

  const bankAccount = await getHotelPaymentAccount(params.hotelId, client);
  console.log("[createVietQrPayment] Bank account retrieved:", {
    bankCode: bankAccount.bankCode,
    accountNumber: bankAccount.accountNumber?.slice(-4),
    accountName: bankAccount.accountName,
  });

  const paymentCode = getPaymentCode(params.bookingCode, params.attemptNo);
  const content = getPaymentContent(params.bookingCode, paymentCode);
  const deadlines = getPaymentDeadlines(now);
  const qrUrl = buildVietQrQuickLink({
    bankCode: bankAccount.bankCode,
    accountNumber: bankAccount.accountNumber,
    template: bankAccount.template,
    amount: params.amount,
    content,
    accountName: bankAccount.accountName,
  });

  console.log(
    "[createVietQrPayment] QR URL generated:",
    qrUrl ? "success" : "failed",
  );

  const payment = await client.payment.create({
    data: {
      bookingId: params.bookingId,
      method: "VIETQR",
      status: "PENDING",
      attemptNo: params.attemptNo,
      paymentCode,
      amount: params.amount,
      content,
      bankCode: bankAccount.bankCode,
      bankName: bankAccount.bankName ?? null,
      accountNumber: bankAccount.accountNumber,
      accountName: bankAccount.accountName,
      vietQrUrl: qrUrl,
      expiresAt: deadlines.expiresAt,
      graceExpiresAt: deadlines.graceExpiresAt,
    },
  });

  console.log("[createVietQrPayment] Payment created:", {
    id: payment.id,
    method: payment.method,
    vietQrUrl: payment.vietQrUrl ? "present" : "missing",
  });

  return payment;
};

const createPayAtHotelPayment = async (
  client: any,
  params: {
    bookingId: string;
    bookingCode: string;
    amount: number;
  },
) => {
  const now = new Date();
  const deadlines = getPaymentDeadlines(now);
  const paymentCode = getPaymentCode(params.bookingCode, 1);

  return client.payment.create({
    data: {
      bookingId: params.bookingId,
      method: "PAY_AT_HOTEL",
      status: "PENDING",
      attemptNo: 1,
      paymentCode,
      amount: params.amount,
      content: `PAY_AT_HOTEL ${params.bookingCode}`,
      bankCode: "PAY_AT_HOTEL",
      bankName: "Thanh toán tại khách sạn",
      accountNumber: "PAY_AT_HOTEL",
      accountName: "Thanh toán tại khách sạn",
      vietQrUrl: "PAY_AT_HOTEL",
      expiresAt: deadlines.expiresAt,
      graceExpiresAt: deadlines.graceExpiresAt,
    },
  });
};

const generateBookingCode = async (client: any) => {
  const prefix = getBookingCodePrefix();
  const latest = await client.booking.findFirst({
    where: { bookingCode: { startsWith: prefix } },
    orderBy: { bookingCode: "desc" },
    select: { bookingCode: true },
  });

  const latestSequence = Number(latest?.bookingCode?.slice(prefix.length) || 0);
  return `${prefix}${String(latestSequence + 1).padStart(4, "0")}`;
};

export const createCustomerBooking = async (
  input: CreateCustomerBookingInput,
) => {
  const paymentMethod =
    input.paymentMethod === "PAY_AT_HOTEL" ? "PAY_AT_HOTEL" : "VIETQR";

  console.log("[createCustomerBooking] Starting with input:", {
    hotelId: input.hotelId,
    roomId: input.roomId,
    requestedPaymentMethod: input.paymentMethod,
    effectivePaymentMethod: paymentMethod,
    bookingType: input.bookingType,
    amount: input.amount,
    voucherCode: input.voucherCode,
  });

  const checkIn = parseRequiredDate(input.checkIn, "Thời gian nhận phòng");
  const checkOut = parseRequiredDate(input.checkOut, "Thời gian trả phòng");
  if (checkOut <= checkIn) {
    throw new AppError(400, "VALIDATION_ERROR", {
      userMessage: "Thời gian trả phòng phải sau thời gian nhận phòng.",
    });
  }

  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(400, "VALIDATION_ERROR", {
      userMessage: "Tổng tiền booking không hợp lệ.",
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const customer = await tx.user.findFirst({
      where: {
        id: input.userId,
        role: "customer",
      },
      select: {
        id: true,
      },
    });

    if (!customer) {
      throw new AppError(401, "AUTH_TOKEN_INVALID", {
        userMessage:
          "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.",
      });
    }

    const roomType = await tx.roomType.findFirst({
      where: {
        id: input.roomId,
        hotelId: input.hotelId,
        status: "active",
      },
      select: {
        id: true,
        hotelId: true,
        name: true,
        totalUnits: true,
      },
    });

    if (!roomType) {
      throw new AppError(404, "RESOURCE_NOT_FOUND", {
        userMessage: "Không tìm thấy phòng đang mở bán.",
      });
    }

    console.log("[createCustomerBooking] Room found:", roomType.id);

    const reservedRooms = await countReservedRooms(
      tx,
      roomType.id,
      { checkIn, checkOut } satisfies BookingRange,
    );

    if (reservedRooms >= roomType.totalUnits) {
      throw new AppError(409, "VALIDATION_ERROR", {
        userMessage:
          "Loại phòng này vừa hết. Vui lòng chọn phòng khác để tiếp tục.",
      });
    }

    const bookingCode = await generateBookingCode(tx);
    console.log("[createCustomerBooking] Booking code generated:", bookingCode);

    const dbBookingType = CUSTOMER_BOOKING_TYPE_TO_DB[input.bookingType];
    const submittedVoucherCode = String(input.voucherCode || "").trim();
    let finalAmount = amount;
    let appliedVoucherId: string | null = null;
    let appliedVoucherCode: string | null = null;

    if (submittedVoucherCode) {
      const voucherResult = await validateVoucher(tx, {
        hotelId: input.hotelId,
        roomTypeId: roomType.id,
        subtotal: amount,
        code: submittedVoucherCode,
        ...(dbBookingType ? { bookingType: dbBookingType } : {}),
      });

      finalAmount = Math.round(Number(voucherResult.finalTotal || amount));
      if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
        throw new AppError(400, "VALIDATION_ERROR", {
          userMessage: "Tổng tiền sau ưu đãi không hợp lệ.",
        });
      }

      appliedVoucherId = voucherResult.voucher.id;
      appliedVoucherCode = voucherResult.voucher.code;
    }

    const booking = await tx.booking.create({
      data: {
        bookingCode,
        userId: input.userId,
        hotelId: input.hotelId,
        roomTypeId: roomType.id,
        checkIn,
        checkOut,
        guests: input.guests,
        totalPrice: finalAmount,
        bookingType: dbBookingType,
        durationValue: input.durationValue,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        voucherCode: appliedVoucherCode,
        status: "PENDING",
      } as any,
    });

    console.log("[createCustomerBooking] Booking created:", booking.id);

    if (appliedVoucherId) {
      await incrementVoucherUsage(tx, appliedVoucherId);
    }

    if (paymentMethod === "PAY_AT_HOTEL") {
      console.log("[createCustomerBooking] Creating PAY_AT_HOTEL payment");
      await createPayAtHotelPayment(tx, {
        bookingId: booking.id,
        bookingCode,
        amount: finalAmount,
      });
    } else {
      console.log("[createCustomerBooking] Creating VIETQR payment");
      await createVietQrPayment(tx, {
        bookingId: booking.id,
        bookingCode,
        hotelId: input.hotelId,
        amount: finalAmount,
        attemptNo: 1,
      });
    }

    console.log(
      "[createCustomerBooking] Payment created, fetching complete booking",
    );

    return tx.booking.findUnique({
      where: { id: booking.id },
      include: bookingInclude,
    });
  });

  if (!created) {
    throw new AppError(500, "INTERNAL_ERROR", {
      userMessage: "Không thể tạo booking.",
    });
  }

  console.log(
    "[createCustomerBooking] Booking created, payments:",
    created.payments?.length,
  );

  if (!created.payments?.[0]) {
    console.error("[createCustomerBooking] No payment found in response", {
      bookingId: created.id,
      paymentsLength: created.payments?.length,
    });
    throw new AppError(500, "INTERNAL_ERROR", {
      userMessage: "Không thể tạo thông tin thanh toán.",
    });
  }

  const booking = normalizeBooking(created);
  const payment = created.payments[0] || null;

  console.log("[createCustomerBooking] Response prepared:", {
    bookingId: booking.id,
    paymentMethod: payment?.method,
    vietQrUrl: payment?.vietQrUrl ? "present" : "missing",
  });

  return {
    booking,
    payment: payment ? toPaymentResponse(payment) : null,
    support: {
      email: SUPPORT_EMAIL,
      chatbox: SUPPORT_CHATBOX,
    },
  };
};

export const getMyBookings = async (userId: string) => {
  const bookings = await prisma.booking.findMany({
    where: { userId },
    include: bookingInclude,
    orderBy: { createdAt: "desc" },
  });

  return bookings.map(normalizeBooking);
};

export const getCustomerBookingById = async (
  userId: string,
  bookingId: string,
) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: bookingInclude,
  });

  if (!booking) {
    throw new AppError(404, "RESOURCE_NOT_FOUND", {
      userMessage: "Không tìm thấy đặt phòng.",
    });
  }

  return normalizeBooking(booking);
};

export const getPaymentStatus = async (userId: string, bookingId: string) => {
  const now = new Date();
  const booking = await prisma.$transaction(async (tx) => {
    const found = await tx.booking.findFirst({
      where: { id: bookingId, userId },
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!found) return null;

    const latestPayment = found.payments[0] || null;
    if (latestPayment) {
      const finalizedPayment = await finalizeExpiredPayment(
        tx,
        latestPayment,
        now,
      );
      if (
        finalizedPayment?.id !== latestPayment.id ||
        finalizedPayment?.status !== latestPayment.status
      ) {
        found.payments = [finalizedPayment];
      }
    }

    return found;
  });

  if (!booking) {
    throw new AppError(404, "RESOURCE_NOT_FOUND", {
      userMessage: "Không tìm thấy đặt phòng.",
    });
  }

  const payment = booking.payments[0] || null;
  const phase = getPaymentPhase(payment, now);

  return {
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    bookingStatus: booking.status,
    paymentStatus: payment?.status || "PENDING",
    paymentPhase: phase,
    amount: payment?.amount || Math.round(Number(booking.totalPrice || 0)),
    failureReason: payment?.failureReason || null,
    failureMessage: payment?.failureMessage || null,
    expiresAt: payment?.expiresAt?.toISOString() || null,
    graceExpiresAt: payment?.graceExpiresAt?.toISOString() || null,
    serverNow: now.toISOString(),
    paidAt: payment?.paidAt?.toISOString() || null,
    canCreateNewQr: phase === "EXPIRED_FINAL",
    isPaid: ["CONFIRMED", "COMPLETED"].includes(booking.status) && payment?.status === "PAID",
    support: {
      email: SUPPORT_EMAIL,
      chatbox: SUPPORT_CHATBOX,
    },
  };
};

export const createNewPaymentQr = async (userId: string, bookingId: string) => {
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, userId },
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!booking) {
      throw new AppError(404, "RESOURCE_NOT_FOUND", {
        userMessage: "Không tìm thấy đặt phòng.",
      });
    }

    if (booking.status === "CONFIRMED" || booking.status === "COMPLETED") {
      throw new AppError(400, "VALIDATION_ERROR", {
        userMessage: "Booking này đã được xác nhận thanh toán.",
      });
    }

    if (booking.status === "CANCELLED") {
      throw new AppError(400, "VALIDATION_ERROR", {
        userMessage: "Không thể tạo QR mới cho booking đã hủy.",
      });
    }

    const latestPayment = booking.payments[0] || null;
    const finalizedPayment = latestPayment
      ? await finalizeExpiredPayment(tx, latestPayment, now)
      : null;
    const phase = getPaymentPhase(finalizedPayment, now);

    if (phase === "ACTIVE" || phase === "GRACE") {
      throw new AppError(400, "VALIDATION_ERROR", {
        userMessage: "QR hiện tại vẫn còn trong thời gian kiểm tra thanh toán.",
      });
    }

    if (phase === "PAID") {
      throw new AppError(400, "VALIDATION_ERROR", {
        userMessage: "Booking này đã được thanh toán.",
      });
    }

    const attemptNo =
      booking.payments.reduce(
        (max: number, payment: any) => Math.max(max, payment.attemptNo || 1),
        0,
      ) + 1;
    await createVietQrPayment(tx, {
      bookingId: booking.id,
      bookingCode: booking.bookingCode || booking.id.slice(0, 8).toUpperCase(),
      hotelId: booking.hotelId!,
      amount: Math.round(Number(booking.totalPrice || 0)),
      attemptNo,
    });

    return tx.booking.findUnique({
      where: { id: booking.id },
      include: bookingInclude,
    });
  });

  if (!created || !created.payments?.[0]) {
    throw new AppError(500, "INTERNAL_ERROR", {
      userMessage: "Không thể tạo QR mới.",
    });
  }

  return {
    booking: normalizeBooking(created),
    payment: toPaymentResponse(created.payments[0]),
    support: {
      email: SUPPORT_EMAIL,
      chatbox: SUPPORT_CHATBOX,
    },
  };
};

export const cancelCustomerBooking = async (
  userId: string,
  bookingId: string,
) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: { payments: true },
  });

  if (!booking) {
    throw new AppError(404, "RESOURCE_NOT_FOUND", {
      userMessage: "Không tìm thấy đặt phòng.",
    });
  }

  if (booking.status === "COMPLETED") {
    throw new AppError(400, "VALIDATION_ERROR", {
      userMessage: "Không thể hủy đặt phòng đã hoàn thành.",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    });

    await tx.payment.updateMany({
      where: {
        bookingId,
        status: "PENDING",
      },
      data: { status: "CANCELLED" },
    });
  });

  return getCustomerBookingById(userId, bookingId);
};
