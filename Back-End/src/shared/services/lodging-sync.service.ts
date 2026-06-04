import prisma from '../../login/lib/prisma';
import { AppError } from '../utils/app-error.util';

type Tx = any;

const DAY_MS = 24 * 60 * 60 * 1000;
const HELD_BOOKING_STATUSES = new Set(['CONFIRMED', 'CHECKED_IN', 'PAYMENT_PENDING', 'COMPLETED']);

const makeValidationError = (message: string) =>
  new AppError(400, 'VALIDATION_ERROR', { userMessage: message });

const makeNotFoundError = (message: string) =>
  new AppError(404, 'RESOURCE_NOT_FOUND', { userMessage: message });

const makeForbiddenError = (message: string) =>
  new AppError(403, 'AUTH_FORBIDDEN', { userMessage: message });

export const mapHotelStatusToPropertyStatus = (status?: string | null) => {
  if (status === 'approved') return 'ACTIVE';
  if (status === 'rejected' || status === 'suspended') return 'INACTIVE';
  return 'PENDING';
};

export const normalizeBookingType = (bookingType?: string | null) => {
  const value = String(bookingType || '').trim().toLowerCase();
  if (value === 'hourly' || value.includes('gio') || value.includes('giờ')) return 'hourly';
  if (value === 'overnight' || value.includes('dem') || value.includes('đêm')) return 'overnight';
  return 'daily';
};

const startOfLocalDate = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate());

export const enumerateStayDates = (checkIn: Date, checkOut: Date) => {
  const start = startOfLocalDate(checkIn);
  const end = startOfLocalDate(checkOut);

  if (end <= start) {
    return [start];
  }

  const dates: Date[] = [];
  for (let cursor = start; cursor < end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    dates.push(cursor);
  }
  return dates.length ? dates : [start];
};

const dateKey = (value: Date) => startOfLocalDate(value).toISOString().slice(0, 10);

const getActivePricingPolicies = (roomType: any) =>
  (roomType?.pricingPolicies || []).filter((policy: any) => policy?.isActive !== false);

export const pickDailyOrFirstActivePolicy = (roomType: any) => {
  const activePolicies = getActivePricingPolicies(roomType);
  return activePolicies.find((policy: any) => policy.bookingType === 'daily') || activePolicies[0] || null;
};

export const pickPolicyForBooking = (roomType: any, bookingType?: string | null) => {
  const normalizedType = normalizeBookingType(bookingType);
  const activePolicies = getActivePricingPolicies(roomType);
  return (
    activePolicies.find((policy: any) => policy.bookingType === normalizedType) ||
    activePolicies.find((policy: any) => policy.bookingType === 'daily') ||
    activePolicies[0] ||
    null
  );
};

const getRoomTypeAvailability = async (
  tx: Tx,
  roomTypeId: string,
  totalUnits: number,
  dates?: Date[],
) => {
  const checkDates = dates?.length ? dates : [startOfLocalDate(new Date())];
  const inventories = await tx.roomInventory.findMany({
    where: {
      roomTypeId,
      date: { in: checkDates },
    },
  });
  const inventoryByDate = new Map(inventories.map((item: any) => [dateKey(item.date), item]));

  const availableByDate = checkDates.map((date) => {
    const inventory = inventoryByDate.get(dateKey(date)) as any;
    if (!inventory) return totalUnits;
    if (inventory.isClosed) return 0;
    return Math.max(0, Number(inventory.totalRooms || totalUnits) - Number(inventory.bookedRooms || 0));
  });

  return Math.max(0, Math.min(...availableByDate));
};

const getHotelForMirror = async (tx: Tx, hotelId: string) => {
  const hotel = await tx.hotel.findUnique({
    where: { id: hotelId },
    include: {
      address: true,
      images: { orderBy: { sortOrder: 'asc' } },
      hotelAmenities: { include: { amenity: true } },
      roomTypes: {
        where: { status: 'active' },
        include: {
          pricingPolicies: { where: { isActive: true } },
          inventory: true,
          media: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!hotel) {
    throw makeNotFoundError('Khong tim thay khach san.');
  }

  return hotel;
};

const getHotelAddressText = (hotel: any) =>
  hotel.address?.fullAddress ||
  hotel.address?.addressLine ||
  [hotel.address?.ward, hotel.address?.district, hotel.address?.city, hotel.address?.province]
    .filter(Boolean)
    .join(', ') ||
  hotel.name;

const getHotelCity = (hotel: any) =>
  hotel.address?.city || hotel.address?.province || 'Chua cap nhat';

const getHotelImages = (hotel: any) =>
  (hotel.images || [])
    .map((image: any) => image.imageUrl)
    .filter((url: any): url is string => Boolean(url));

const getHotelAmenities = (hotel: any) =>
  (hotel.hotelAmenities || [])
    .map((item: any) => item.amenity?.name)
    .filter((name: any): name is string => Boolean(name));

const formatVnd = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString('vi-VN')}d`;

const upsertHotelCard = async (tx: Tx, hotel: any) => {
  const firstRoomType = hotel.roomTypes?.[0];
  const policy = firstRoomType ? pickDailyOrFirstActivePolicy(firstRoomType) : null;
  const priceValue = policy ? Number(policy.basePrice) : 0;
  const image = getHotelImages(hotel)[0] || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800';
  const city = getHotelCity(hotel);
  const district = hotel.address?.district || city;
  const isActive = hotel.status === 'approved';

  await tx.hotelCard.upsert({
    where: { id: hotel.id },
    update: {
      slug: hotel.slug,
      name: hotel.name,
      rating: Number(hotel.avgRating || 0),
      reviews: Number(hotel.totalReviews || 0),
      city,
      area: district,
      location: getHotelAddressText(hotel),
      district,
      price: formatVnd(priceValue),
      priceValue: Math.round(priceValue),
      unit: '/ dem',
      image,
      badge: hotel.isFeatured ? 'Noi bat' : null,
      tags: [String(hotel.propertyType || 'hotel')],
      isActive,
    },
    create: {
      id: hotel.id,
      slug: hotel.slug,
      name: hotel.name,
      rating: Number(hotel.avgRating || 0),
      reviews: Number(hotel.totalReviews || 0),
      city,
      area: district,
      location: getHotelAddressText(hotel),
      district,
      discount: null,
      price: formatVnd(priceValue),
      priceValue: Math.round(priceValue),
      unit: '/ dem',
      oldPrice: null,
      image,
      badge: hotel.isFeatured ? 'Noi bat' : null,
      tags: [String(hotel.propertyType || 'hotel')],
      isActive,
    },
  });
};

export const syncHotelMirror = async (
  tx: Tx,
  hotelId: string,
  options: { checkIn?: Date; checkOut?: Date } = {},
) => {
  const hotel = await getHotelForMirror(tx, hotelId);
  const stayDates =
    options.checkIn && options.checkOut
      ? enumerateStayDates(options.checkIn, options.checkOut)
      : [startOfLocalDate(new Date())];

  await tx.property.upsert({
    where: { id: hotel.id },
    update: {
      name: hotel.name,
      description: hotel.description,
      address: getHotelAddressText(hotel),
      city: getHotelCity(hotel),
      type: String(hotel.propertyType || 'hotel'),
      images: getHotelImages(hotel),
      amenities: getHotelAmenities(hotel),
      status: mapHotelStatusToPropertyStatus(hotel.status),
      ownerId: hotel.ownerId,
    },
    create: {
      id: hotel.id,
      name: hotel.name,
      description: hotel.description,
      address: getHotelAddressText(hotel),
      city: getHotelCity(hotel),
      type: String(hotel.propertyType || 'hotel'),
      images: getHotelImages(hotel),
      amenities: getHotelAmenities(hotel),
      status: mapHotelStatusToPropertyStatus(hotel.status),
      ownerId: hotel.ownerId,
    },
  });

  const rooms = [];
  for (const roomType of hotel.roomTypes || []) {
    const policy = pickDailyOrFirstActivePolicy(roomType);
    const price = policy ? Number(policy.basePrice) : 0;
    const totalRooms = Number(roomType.totalUnits || 0);
    const available = await getRoomTypeAvailability(tx, roomType.id, totalRooms, stayDates);

    const room = await tx.room.upsert({
      where: { id: roomType.id },
      update: {
        propertyId: hotel.id,
        name: roomType.name,
        type: roomType.bedType || roomType.slug || 'room',
        price,
        capacity: Number(roomType.maxGuests || 1),
        totalRooms,
        available,
      },
      create: {
        id: roomType.id,
        propertyId: hotel.id,
        name: roomType.name,
        type: roomType.bedType || roomType.slug || 'room',
        price,
        capacity: Number(roomType.maxGuests || 1),
        totalRooms,
        available,
      },
    });
    rooms.push(room);
  }

  await upsertHotelCard(tx, hotel);

  return { hotel, rooms };
};

export const ensureApprovedHotelMirror = async (
  tx: Tx,
  hotelId: string,
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date,
) => {
  const result = await syncHotelMirror(tx, hotelId, { checkIn, checkOut });
  if (result.hotel.status !== 'approved') {
    throw makeForbiddenError('Khach san chua duoc duyet.');
  }

  const roomType = result.hotel.roomTypes.find((item: any) => item.id === roomTypeId);
  if (!roomType) {
    throw makeNotFoundError('Khong tim thay loai phong.');
  }

  const policy = pickPolicyForBooking(roomType, null);
  if (!policy) {
    throw makeValidationError('Loai phong chua co chinh sach gia active.');
  }

  return { ...result, roomType };
};

export const assertInventoryAvailable = async (
  tx: Tx,
  roomTypeId: string,
  totalUnits: number,
  checkIn: Date,
  checkOut: Date,
) => {
  const dates = enumerateStayDates(checkIn, checkOut);
  const inventories = await tx.roomInventory.findMany({
    where: { roomTypeId, date: { in: dates } },
  });
  const inventoryByDate = new Map(inventories.map((item: any) => [dateKey(item.date), item]));

  for (const date of dates) {
    const inventory = inventoryByDate.get(dateKey(date)) as any;
    const totalRooms = Number(inventory?.totalRooms ?? totalUnits);
    const bookedRooms = Number(inventory?.bookedRooms ?? 0);

    if (inventory?.isClosed || totalRooms <= 0 || bookedRooms >= totalRooms) {
      throw makeValidationError(`Phong da het hoac dong trong ngay ${dateKey(date)}.`);
    }
  }
};

const applyInventoryDelta = async (
  tx: Tx,
  roomTypeId: string,
  totalUnits: number,
  checkIn: Date,
  checkOut: Date,
  delta: 1 | -1,
) => {
  const dates = enumerateStayDates(checkIn, checkOut);

  for (const date of dates) {
    const inventory = await tx.roomInventory.findUnique({
      where: { roomTypeId_date: { roomTypeId, date } },
    });

    if (delta === 1) {
      if (!inventory) {
        if (totalUnits <= 0) {
          throw makeValidationError(`Phong da het trong ngay ${dateKey(date)}.`);
        }
        await tx.roomInventory.create({
          data: {
            roomTypeId,
            date,
            totalRooms: totalUnits,
            bookedRooms: 1,
            isClosed: false,
          },
        });
        continue;
      }

      const updated = await tx.roomInventory.updateMany({
        where: {
          id: inventory.id,
          isClosed: false,
          bookedRooms: { lt: inventory.totalRooms },
        },
        data: { bookedRooms: { increment: 1 } },
      });

      if (updated.count !== 1) {
        throw makeValidationError(`Phong da het hoac dong trong ngay ${dateKey(date)}.`);
      }
      continue;
    }

    if (inventory) {
      await tx.roomInventory.updateMany({
        where: { id: inventory.id, bookedRooms: { gt: 0 } },
        data: { bookedRooms: { decrement: 1 } },
      });
    }
  }
};

export const calculateBookingSubtotal = (
  roomType: any,
  bookingType: string | undefined,
  checkIn: Date,
  checkOut: Date,
) => {
  const policy = pickPolicyForBooking(roomType, bookingType);
  if (!policy) {
    throw makeValidationError('Loai phong chua co chinh sach gia active.');
  }

  const normalizedType = normalizeBookingType(bookingType);
  const basePrice = Number(policy.basePrice || 0);
  if (normalizedType === 'hourly') {
    const hours = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (60 * 60 * 1000)));
    return basePrice * hours;
  }
  if (normalizedType === 'daily') {
    const nights = Math.max(1, enumerateStayDates(checkIn, checkOut).length);
    return basePrice * nights;
  }
  return basePrice;
};

export const updateBookingStatusWithInventory = async (
  tx: Tx,
  bookingId: string,
  nextStatus: string,
) => {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: {
      room: true,
      roomType: true,
      property: true,
      hotel: true,
    },
  });

  if (!booking) {
    throw makeNotFoundError('Khong tim thay booking.');
  }

  if (booking.status === nextStatus) {
    return booking;
  }

  const oldHeld = HELD_BOOKING_STATUSES.has(booking.status);
  const nextHeld = HELD_BOOKING_STATUSES.has(nextStatus);
  const inventoryRoomTypeId = booking.roomTypeId || booking.roomId;
  const totalUnits = Number(booking.roomType?.totalUnits ?? booking.room?.totalRooms ?? 0);

  if (!oldHeld && nextHeld) {
    if (!inventoryRoomTypeId) {
      throw makeValidationError('Booking chua co thong tin loai phong.');
    }
    await applyInventoryDelta(tx, inventoryRoomTypeId, totalUnits, booking.checkIn, booking.checkOut, 1);
  } else if (oldHeld && !nextHeld) {
    if (!inventoryRoomTypeId) {
      throw makeValidationError('Booking chua co thong tin loai phong.');
    }
    await applyInventoryDelta(tx, inventoryRoomTypeId, totalUnits, booking.checkIn, booking.checkOut, -1);
  }

  return tx.booking.update({
    where: { id: bookingId },
    data: { status: nextStatus },
    include: {
      user: { select: { username: true, email: true, phone: true } },
      room: { include: { property: { select: { id: true, name: true, address: true, ownerId: true } } } },
      roomType: { include: { hotel: { select: { id: true, name: true } } } },
      hotel: true,
      property: true,
      reviews: true,
    },
  });
};

export const recalculateHotelRating = async (tx: Tx, hotelId: string) => {
  const approvedReviews = await tx.review.findMany({
    where: {
      status: 'APPROVED',
      booking: { propertyId: hotelId },
    },
    select: { rating: true },
  });

  const totalReviews = approvedReviews.length;
  const avgRating = totalReviews
    ? Number((approvedReviews.reduce((sum: number, review: any) => sum + Number(review.rating || 0), 0) / totalReviews).toFixed(1))
    : 0;

  await tx.hotel.update({
    where: { id: hotelId },
    data: { avgRating, totalReviews },
  });

  await tx.hotelCard.updateMany({
    where: { id: hotelId },
    data: { rating: avgRating, reviews: totalReviews },
  });

  return { avgRating, totalReviews };
};

export const syncHotelMirrorWithDefaultClient = (hotelId: string) =>
  prisma.$transaction((tx) => syncHotelMirror(tx, hotelId));
