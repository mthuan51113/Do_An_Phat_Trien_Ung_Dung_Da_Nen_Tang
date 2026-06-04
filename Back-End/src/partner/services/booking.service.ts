import prisma from '../../login/lib/prisma';
import { updateBookingStatusWithInventory } from '../../shared/services/lodging-sync.service';
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from '../../shared/errors/AppError';
import type { BookingStatus } from '@prisma/client';

const ALLOWED_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'PAYMENT_PENDING',
  'CANCELLED',
  'COMPLETED',
]);

const normalizeBookingStatus = (status?: string) => {
  if (!status || status === 'ALL') return undefined;

  const normalizedStatus = String(status).trim().toUpperCase();

  if (!ALLOWED_STATUSES.has(normalizedStatus)) {
    throw new BadRequestError(
      'Trạng thái booking không hợp lệ',
      'VALIDATION_ERROR'
    );
  }

  return normalizedStatus as BookingStatus;
};

const normalizeBooking = (booking: any) => ({
  id: booking.id,
  checkIn: booking.checkIn?.toISOString?.() || booking.checkIn,
  checkOut: booking.checkOut?.toISOString?.() || booking.checkOut,
  totalPrice: Number(booking.totalPrice || 0),
  status: booking.status,

  user: {
    username: booking.user?.username || 'Khách hàng',
    phone: booking.user?.phone || null,
  },

  room: {
    name: booking.room?.name || booking.roomType?.name || 'Phòng tiêu chuẩn',
  },

  property: {
    id: booking.property?.id || booking.hotel?.id || booking.room?.property?.id || booking.roomType?.hotel?.id || '',
    name:
      booking.property?.name ||
      booking.hotel?.name ||
      booking.room?.property?.name ||
      booking.roomType?.hotel?.name ||
      'Cơ sở lưu trú',
  },
});

export class BookingService {
  /**
   * Lấy danh sách đặt phòng thuộc cơ sở lưu trú của Partner
   */
  async listByPartner(partnerId: string, status?: string) {
    const whereClause: any = {
      OR: [
        { property: { ownerId: partnerId } },
        { hotel: { ownerId: partnerId } }
      ]
    };

    const normalizedStatus = normalizeBookingStatus(status);

    if (normalizedStatus) {
      whereClause.status = normalizedStatus;
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            username: true,
            email: true,
            phone: true,
          },
        },

        room: {
          select: {
            name: true,
          },
        },

        roomType: {
          select: {
            name: true,
            hotel: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },

        property: {
          select: {
            id: true,
            name: true,
          },
        },

        hotel: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return bookings.map(normalizeBooking);
  }

  /**
   * Cập nhật trạng thái đơn đặt phòng
   */
  async updateStatus(
    bookingId: string,
    partnerId: string,
    status: BookingStatus
  ) {
    const normalizedStatus = normalizeBookingStatus(status);

    if (!normalizedStatus) {
      throw new BadRequestError(
        'Trạng thái booking không hợp lệ',
        'VALIDATION_ERROR'
      );
    }

    const booking = await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },
      include: {
        property: {
          select: {
            ownerId: true,
          },
        },
        hotel: {
          select: {
            ownerId: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundError(
        'Không tìm thấy đơn đặt phòng',
        'BOOKING_NOT_FOUND'
      );
    }

    const isOwner = booking.property?.ownerId === partnerId || booking.hotel?.ownerId === partnerId;

    if (!isOwner) {
      throw new ForbiddenError('Bạn không có quyền cập nhật đơn đặt phòng này');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedBooking = await updateBookingStatusWithInventory(tx, bookingId, normalizedStatus);

      if (normalizedStatus === 'COMPLETED') {
        await tx.payment.updateMany({
          where: {
            bookingId,
            status: 'PENDING',
          },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            failureReason: null,
            failureMessage: null,
          },
        });
      }

      return updatedBooking;
    });

    return normalizeBooking(updated);
  }
}

export const bookingService = new BookingService();
