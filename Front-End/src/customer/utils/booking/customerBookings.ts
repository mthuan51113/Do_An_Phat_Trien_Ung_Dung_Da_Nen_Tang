import { bookingsApi, type PaymentFailureReason, type PaymentStatus } from '@/src/customer/services/booking/bookings.api';

export type CustomerBookingStatus =
  | 'Đang chờ xử lý'
  | 'Chờ nhận phòng'
  | 'Đã nhận phòng'
  | 'Chờ thanh toán'
  | 'Hoàn thành'
  | 'Không nhận phòng'
  | 'Không ghi nhận thanh toán'
  | 'Đã huỷ';

export type CustomerBooking = {
  id: string;
  code: string;
  hotelId: string;
  hotelName: string;
  hotelAddress?: string;
  hotelImage?: string;
  roomId?: string;
  roomName: string;
  roomImage: string;
  price: string;
  bookingType: string;
  checkIn: string;
  checkOut: string;
  hours?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  status: CustomerBookingStatus;
  paymentMethod?: 'VIETQR' | 'PAY_AT_HOTEL';
  paymentStatus?: PaymentStatus;
  paymentFailureReason?: PaymentFailureReason | null;
  paymentFailureMessage?: string | null;
  createdAt: string;
};

export const customerBookingsStorage = {
  getAll: async (): Promise<CustomerBooking[]> => bookingsApi.getMine(),

  getById: async (id: string): Promise<CustomerBooking | null> => bookingsApi.getById(id),

  updateStatus: async (id: string, status: CustomerBookingStatus): Promise<CustomerBooking | null> => {
    if (status === 'Đã huỷ') {
      return bookingsApi.cancel(id);
    }

    throw new Error('Trạng thái đặt phòng chỉ được cập nhật thông qua API.');
  },
};
