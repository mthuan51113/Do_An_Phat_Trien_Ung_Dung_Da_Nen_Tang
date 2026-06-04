import type { CustomerBookingStatus } from '@/src/customer/utils/booking/customerBookings';

export type BookingStatusFilter = 'all' | CustomerBookingStatus;

export const BOOKING_STATUS_FILTERS: { id: BookingStatusFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'Đang chờ xử lý', label: 'Đang chờ xử lý' },
  { id: 'Chờ nhận phòng', label: 'Chờ nhận phòng' },
  { id: 'Đã nhận phòng', label: 'Đã nhận phòng' },
  { id: 'Chờ thanh toán', label: 'Chờ thanh toán' },
  { id: 'Hoàn thành', label: 'Hoàn thành' },
  { id: 'Không nhận phòng', label: 'Không nhận phòng' },
  { id: 'Không ghi nhận thanh toán', label: 'Không ghi nhận thanh toán' },
  { id: 'Đã huỷ', label: 'Đã huỷ' },
];
