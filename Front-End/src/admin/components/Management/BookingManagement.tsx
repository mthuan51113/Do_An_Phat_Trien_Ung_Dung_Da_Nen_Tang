import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DataTable } from './DataTable';
import { adminService } from '../../services/admin.service';
import { CheckCircle, Trash2, XCircle } from 'lucide-react-native';
import { confirmAction } from '../../utils/confirmAction';
import { ModuleAccess } from '../../utils/permissions';
import { useAdminTheme } from '../AdminShell';

const fullAccess: ModuleAccess = { canView: true, canEdit: true, canDelete: true, canApprove: true, canExport: false };
const statuses = ['', 'PENDING', 'CONFIRMED', 'CHECKED_IN', 'PAYMENT_PENDING', 'COMPLETED', 'CANCELLED'];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Chờ xử lý', color: '#F59E0B' },
  CONFIRMED: { label: 'Đã xác nhận', color: '#3B82F6' },
  CHECKED_IN: { label: 'Đã nhận phòng', color: '#2563EB' },
  PAYMENT_PENDING: { label: 'Chờ thanh toán', color: '#D97706' },
  COMPLETED: { label: 'Hoàn tất', color: '#10B981' },
  CANCELLED: { label: 'Đã hủy', color: '#EF4444' },
};

export const BookingManagement = ({ permissions = fullAccess }: { permissions?: ModuleAccess }) => {
  const { isLight } = useAdminTheme();
  const [bookings, setBookings] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminService.getBookings({
        search: searchQuery,
        status: statusFilter,
        from: fromDate,
        to: toDate,
        page,
        limit: 10,
      });
      setBookings(result.bookings || result.items || []);
      setTotalCount(result.pagination?.total ?? result.total ?? 0);
    } catch (error) {
      console.error('Failed to fetch bookings:', error);
    } finally {
      setLoading(false);
    }
  }, [fromDate, page, searchQuery, statusFilter, toDate]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setPage(1);
  };

  const handleStatusFilter = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await adminService.downloadExport('bookings', {
        search: searchQuery,
        status: statusFilter,
        from: fromDate,
        to: toDate,
      }, 'bookings');
    } catch (error: any) {
      Alert.alert('Lỗi', error?.response?.status === 403 ? 'Bạn không có quyền xuất dữ liệu' : 'Xuất file thất bại');
    } finally {
      setExporting(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      await adminService.updateBookingStatus(id, status);
      Alert.alert('Thành công', `Đã cập nhật trạng thái ${status}`);
      fetchBookings();
    } catch {
      Alert.alert('Lỗi', 'Không thể cập nhật trạng thái');
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirmAction('Xác nhận', 'Bạn có chắc muốn xóa đặt phòng này?');
    if (!confirmed) return;

    try {
      await adminService.deleteBooking(id);
      Alert.alert('Thành công', 'Đã xóa đặt phòng');
      fetchBookings();
    } catch {
      Alert.alert('Lỗi', 'Không thể xóa đặt phòng');
    }
  };

  const columns = [
    { key: 'id', label: 'Mã đơn', render: (val: string) => <Text style={{ color: isLight ? '#64748B' : '#94A3B8', fontSize: 13 }}>#{val.substring(0, 8)}</Text> },
    { key: 'user', label: 'Khách hàng', render: (val: any) => <Text style={{ color: isLight ? '#0F172A' : '#FFFFFF', fontWeight: '600' }}>{val?.username || val?.email || 'Khách vãng lai'}</Text> },
    { key: 'property', label: 'Lưu trú', render: (val: any) => <Text style={{ color: isLight ? '#334155' : '#CBD5E1' }}>{val?.name || 'N/A'}</Text> },
    { key: 'checkIn', label: 'Check-in', render: (val: string) => <Text style={{ color: isLight ? '#64748B' : '#94A3B8' }}>{new Date(val).toLocaleDateString('vi-VN')}</Text> },
    { key: 'totalPrice', label: 'Tổng tiền', render: (val: number) => <Text style={{ color: isLight ? '#2563EB' : '#60A5FA', fontWeight: 'bold' }}>{Number(val || 0).toLocaleString('vi-VN')} VND</Text> },
    {
      key: 'status',
      label: 'Trạng thái',
      render: (status: string) => {
        const config = STATUS_CONFIG[status] || { label: status || 'Không rõ', color: '#64748B' };
        const color = config.color;
        const bgColor = `${color}1A`;
        return (
          <View style={[styles.badge, { backgroundColor: bgColor }]}>
            <Text style={[styles.badgeText, { color }]}>{config.label}</Text>
          </View>
        );
      },
    },
  ];

  const actions = [
    ...(permissions.canApprove || permissions.canEdit
      ? [
          { label: 'Duyệt', icon: CheckCircle, color: '#10B981', onPress: (item: any) => handleUpdateStatus(item.id, 'CONFIRMED') },
          { label: 'Hủy', icon: XCircle, color: '#F59E0B', onPress: (item: any) => handleUpdateStatus(item.id, 'CANCELLED') },
        ]
      : []),
    ...(permissions.canDelete ? [{ label: 'Xóa', icon: Trash2, color: '#EF4444', onPress: (item: any) => handleDelete(item.id) }] : []),
  ];

  return (
    <View style={styles.container}>
      <DataTable
        title="Quản lý đặt phòng hệ thống"
        columns={columns}
        data={bookings}
        onSearch={handleSearch}
        onExport={permissions.canExport ? () => handleExport() : undefined}
        exporting={exporting}
        actions={actions}
        serverSide
        loading={loading}
        totalCount={totalCount}
        page={page}
        onPageChange={setPage}
        filterContent={
          <View style={styles.filterStack}>
            <View style={styles.filterRow}>
              {statuses.map((status) => (
                <TouchableOpacity
                  key={status || 'ALL'}
                  style={[styles.filterChip, statusFilter === status && styles.filterChipActive]}
                  onPress={() => handleStatusFilter(status)}
                >
                  <Text style={[styles.filterChipText, statusFilter === status && styles.filterChipTextActive]}>{status || 'Tất cả'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.dateRow}>
              <TextInput style={styles.dateInput} placeholder="Từ ngày YYYY-MM-DD" value={fromDate} onChangeText={(value) => { setFromDate(value); setPage(1); }} />
              <TextInput style={styles.dateInput} placeholder="Đến ngày YYYY-MM-DD" value={toDate} onChangeText={(value) => { setToDate(value); setPage(1); }} />
            </View>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterStack: { gap: 10 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
  filterChipActive: { borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
  filterChipText: { color: '#64748B', fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: '#2563EB' },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateInput: { minWidth: 180, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 12, height: 38, color: '#0F172A', ...Platform.select({ web: { outlineStyle: 'none' } as any }) } as any,
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
});
