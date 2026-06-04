import prisma from "../../login/lib/prisma";
import { Prisma } from "@prisma/client";
import { updateBookingStatusWithInventory } from "../../shared/services/lodging-sync.service";
import { decrementVoucherUsageByCode } from "../../shared/services/voucher-validation.service";
import {
  buildListResult,
  type DateRange,
  type SortOrder,
} from "../utils/admin-query.util";

const normalizeBooking = (booking: any) => ({
  ...booking,
  property: booking.property || booking.hotel || booking.room?.property || null,
  room: booking.room || booking.roomType || null,
});

export type AdminBookingListOptions = {
  q?: string | undefined;
  search?: string | undefined;
  status?: string | undefined;
  paymentId?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  sortBy?: string | undefined;
  sortOrder?: SortOrder | undefined;
  dateRange?: DateRange | undefined;
  paginate?: boolean | undefined;
};

const ALLOWED_STATUSES = new Set([
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "PAYMENT_PENDING",
  "CANCELLED",
  "COMPLETED",
]);
const bookingSortFields = new Set([
  "createdAt",
  "updatedAt",
  "checkIn",
  "checkOut",
  "totalPrice",
  "status",
]);

const buildBookingWhere = (
  options: AdminBookingListOptions,
): Prisma.BookingWhereInput => {
  const query = String(options.search || options.q || "").trim();
  const where: Prisma.BookingWhereInput = {};

  if (query) {
    where.OR = [
      { id: { contains: query, mode: "insensitive" } },
      { paymentId: { contains: query, mode: "insensitive" } },
      { user: { username: { contains: query, mode: "insensitive" } } },
      { user: { email: { contains: query, mode: "insensitive" } } },
      { room: { name: { contains: query, mode: "insensitive" } } },
      {
        room: { property: { name: { contains: query, mode: "insensitive" } } },
      },
      { property: { name: { contains: query, mode: "insensitive" } } },
    ];
  }

  if (options.status && ALLOWED_STATUSES.has(options.status)) {
    where.status = options.status as any;
  }

  if (options.paymentId) {
    where.paymentId = { contains: options.paymentId, mode: "insensitive" };
  }

  if (options.dateRange?.from || options.dateRange?.to) {
    where.createdAt = {
      ...(options.dateRange.from ? { gte: options.dateRange.from } : {}),
      ...(options.dateRange.to ? { lte: options.dateRange.to } : {}),
    };
  }

  return where;
};

const buildBookingOrderBy = (
  sortBy?: string,
  sortOrder: SortOrder = "desc",
) => ({
  [bookingSortFields.has(String(sortBy || "")) ? String(sortBy) : "createdAt"]:
    sortOrder,
});

export const bookingService = {
  getAllBookings: async (options: AdminBookingListOptions = {}) => {
    const { page = 1, limit = 10, paginate = true } = options;
    const skip = (page - 1) * limit;
    const where = buildBookingWhere(options);

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: { select: { username: true, email: true, phone: true } },
          property: { select: { id: true, name: true, address: true } },
          hotel: { select: { id: true, name: true } },
          room: {
            include: {
              property: { select: { name: true, address: true } },
            },
          },
          roomType: {
            include: {
              hotel: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: buildBookingOrderBy(options.sortBy, options.sortOrder) as any,
        ...(paginate ? { skip, take: limit } : {}),
      } as any),
      prisma.booking.count({ where }),
    ]);

    return buildListResult(
      "bookings",
      bookings.map(normalizeBooking),
      page,
      limit,
      total,
    );
  },

  updateBookingStatus: async (id: string, status: string) => {
    const booking = await prisma.$transaction(async (tx) => {
      const current = await tx.booking.findUnique({
        where: { id },
        select: {
          status: true,
          voucherCode: true,
          propertyId: true,
          hotelId: true,
          paymentId: true,
        },
      });

      const updated = await updateBookingStatusWithInventory(tx, id, status);

      if (
        current &&
        current.status !== "CANCELLED" &&
        status === "CANCELLED" &&
        current.voucherCode &&
        !current.paymentId &&
        (current.propertyId || current.hotelId)
      ) {
        await decrementVoucherUsageByCode(
          tx,
          current.propertyId || current.hotelId!,
          current.voucherCode,
        );
      }

      return updated;
    });
    return normalizeBooking(booking);
  },

  deleteBooking: async (id: string) => {
    await prisma.$transaction(async (tx) => {
      const current = await tx.booking.findUnique({
        where: { id },
        select: {
          status: true,
          voucherCode: true,
          propertyId: true,
          hotelId: true,
          paymentId: true,
        },
      });
      if (current && current.status !== "CANCELLED") {
        await updateBookingStatusWithInventory(tx, id, "CANCELLED");
      }
      if (current?.voucherCode && !current.paymentId && (current.propertyId || current.hotelId)) {
        await decrementVoucherUsageByCode(
          tx,
          current.propertyId || current.hotelId!,
          current.voucherCode,
        );
      }
      await tx.review.deleteMany({ where: { bookingId: id } });
      await tx.booking.delete({ where: { id } });
    });
  },
};
