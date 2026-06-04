import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Landmark,
  Mail,
  QrCode,
  RefreshCw,
  Tag,
} from 'lucide-react-native';
import ImageWithFallback from '@/src/customer/components/common/ImageWithFallback';
import BookingSuccessView from '@/src/customer/components/booking/BookingSuccessView';
import BookingQrPaymentView from '@/src/customer/components/booking/BookingQrPaymentView';
import BookingFormView from '@/src/customer/components/booking/BookingFormView';
import RoomDetailModal from '@/src/customer/components/rooms/RoomDetailModal';
import {
  bookingsApi,
  type BookingPaymentQr,
  type CheckoutVoucher,
  type CreateQrBookingResponse,
  type ValidateVoucherResponse,
} from '@/src/customer/services/booking/bookings.api';
import { hotelsApi } from '@/src/customer/services/hotels/hotels.api';
import { getMyProfile } from '@/src/customer/core/api/profile.api';
import { useAuth } from '@/src/customer/hooks/useAuth';
import { useCustomerBack } from '@/src/customer/navigation/useCustomerBack';
import { getParamText } from '@/src/customer/navigation/routeParams';
import { useThemeContext } from '@/src/customer/theme/ThemeContext';
import { useVoucherCollect } from '@/src/customer/context/VoucherCollectContext';
import { getBookingDurationLabel } from '@/src/customer/utils/rooms/roomDisplay';
import { getStayHubPaymentView } from '@/src/customer/utils/booking/sepay';
import { styles, PRIMARY, PRIMARY_FILL, TEXT_DARK, TEXT_MUTED, BORDER, SURFACE, PAGE_BG, SUCCESS } from '@/src/customer/styles/booking/bookingConfirm.styles';
import {
  PaymentMethodId, PAYMENT_METHODS, BookingPoint,
  formatMoney, parseBookingPoint, formatCancellationDeadline, toBookingIso,
  getErrorMessage, formatCountdown, withLocalQrCountdown, getLocalPaymentPhase,
  getPaymentFailureText, getTimeMs,
  DEFAULT_ROOM_IMAGE, SUPPORT_EMAIL, PAYMENT_RULES,
} from '@/src/customer/utils/booking/bookingConfirm.utils';
import type { Room } from '@/src/customer/types/hotels';

export default function BookingConfirmScreen() {
  const router = useRouter();
  const goBack = useCustomerBack('/customer/bookings');
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { currentTheme } = useThemeContext();
  const { user } = useAuth();
  const { collected } = useVoucherCollect();
  const params = useLocalSearchParams<{
    hotelId?: string;
    hotelName?: string;
    hotelAddress?: string;
    hotelImage?: string;
    roomId?: string;
    roomName?: string;
    roomImage?: string;
    price?: string;
    bookingType?: string;
    checkIn?: string;
    checkOut?: string;
    hours?: string;
  }>();

  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmedBookingId, setConfirmedBookingId] = useState<string | null>(null);
  const [confirmedBookingCode, setConfirmedBookingCode] = useState<string | null>(null);
  const [confirmedPaymentMethod, setConfirmedPaymentMethod] = useState<PaymentMethodId | null>(null);
  const [paymentSession, setPaymentSession] = useState<CreateQrBookingResponse | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [creatingNewQr, setCreatingNewQr] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [expiredNoticePaymentId, setExpiredNoticePaymentId] = useState<string | null>(null);
  const [showPaymentMethodSheet, setShowPaymentMethodSheet] = useState(false);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<PaymentMethodId | null>('vietqr');
  const [selectedRoomForDetail, setSelectedRoomForDetail] = useState<Room | null>(null);
  const [roomDetailLoading, setRoomDetailLoading] = useState(false);
  const [availableVouchers, setAvailableVouchers] = useState<CheckoutVoucher[]>([]);
  const [voucherCode, setVoucherCode] = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState<ValidateVoucherResponse | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherApplying, setVoucherApplying] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const isWebLayout = width >= 768;

  const hotelId = getParamText(params.hotelId);
  const roomId = getParamText(params.roomId);
  const hotelName = getParamText(params.hotelName) || 'Khách sạn';
  const roomName = getParamText(params.roomName) || 'STANDARD ROOM';
  const hotelAddress = getParamText(params.hotelAddress) || 'Địa chỉ khách sạn đang cập nhật';
  const roomImage = getParamText(params.roomImage) || DEFAULT_ROOM_IMAGE;
  const amount = Math.round(Number(getParamText(params.price)) || 0);
  const bookingType = getParamText(params.bookingType) || 'Theo giờ';
  const durationLabel = getBookingDurationLabel(bookingType, getParamText(params.hours));
  const checkIn = useMemo(() => parseBookingPoint(getParamText(params.checkIn)), [params.checkIn]);
  const checkOut = useMemo(() => parseBookingPoint(getParamText(params.checkOut)), [params.checkOut]);
  const cancellationDeadline = useMemo(() => formatCancellationDeadline(checkIn), [checkIn]);

  const paymentBreakdown = useMemo(() => {
    const durationValue = Number(getParamText(params.hours)) || 1;
    const isDaily = bookingType === 'Theo ngày';

    // Calculate number of days between checkin and checkout
    const days = checkIn.date && checkOut.date
      ? Math.ceil((checkOut.date.getTime() - checkIn.date.getTime()) / (1000 * 60 * 60 * 24))
      : durationValue;

    // Calculate price per unit
    const pricePerUnit = isDaily ? Math.round(amount / durationValue) : Math.round(amount / durationValue);

    return {
      duration: durationValue,
      days,
      pricePerUnit,
      isDaily,
      durationLabel: isDaily ? 'ngày' : 'giờ',
      pricePerUnitText: formatMoney(String(pricePerUnit)),
      subtotalText: formatMoney(String(amount)),
    };
  }, [amount, bookingType, checkIn.date, checkOut.date, params.hours]);

  const customerName = user?.username || 'Joyer.673';
  const [customerPhone, setCustomerPhone] = useState<string>('Chưa cập nhật');
  const [customerEmail, setCustomerEmail] = useState<string>(user?.email || '');

  useEffect(() => {
    getMyProfile().then(profile => {
      if (profile.phone) setCustomerPhone(profile.phone);
      if (profile.email) setCustomerEmail(profile.email);
    }).catch(() => {});
  }, []);

  const collectedVoucherCodes = useMemo(
    () => new Set(collected.map(item => item.code.trim().toUpperCase()).filter(Boolean)),
    [collected],
  );

  const sortedAvailableVouchers = useMemo(
    () => [...availableVouchers].sort((a, b) => {
      const aSaved = collectedVoucherCodes.has(String(a.code).toUpperCase());
      const bSaved = collectedVoucherCodes.has(String(b.code).toUpperCase());
      if (aSaved !== bSaved) return aSaved ? -1 : 1;
      return Number(b.discount || 0) - Number(a.discount || 0);
    }),
    [availableVouchers, collectedVoucherCodes],
  );

  const voucherDiscountAmount = appliedVoucher
    ? Math.round(Number(appliedVoucher.discount || 0))
    : 0;
  const finalAmount = appliedVoucher
    ? Math.round(Number(appliedVoucher.finalTotal || amount))
    : amount;
  const finalPrice = formatMoney(String(finalAmount));
  const voucherDiscountText = appliedVoucher
    ? formatMoney(String(voucherDiscountAmount))
    : null;

  useEffect(() => {
    let active = true;

    setAppliedVoucher(null);
    setVoucherError(null);

    if (!hotelId || !roomId || amount <= 0) {
      setAvailableVouchers([]);
      return () => {
        active = false;
      };
    }

    setVoucherLoading(true);
    bookingsApi
      .getCheckoutVouchers(hotelId, { roomTypeId: roomId, subtotal: amount })
      .then(vouchers => {
        if (active) setAvailableVouchers(vouchers);
      })
      .catch(error => {
        if (!active) return;
        setAvailableVouchers([]);
        setVoucherError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setVoucherLoading(false);
      });

    return () => {
      active = false;
    };
  }, [amount, hotelId, roomId]);

  const handleVoucherCodeChange = useCallback((value: string) => {
    const normalized = value.toUpperCase();
    setVoucherCode(normalized);
    setVoucherError(null);
    if (appliedVoucher && normalized.trim() !== appliedVoucher.voucher.code) {
      setAppliedVoucher(null);
    }
  }, [appliedVoucher]);

  const validateVoucherCode = useCallback(async (code: string) => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      const message = 'Vui lòng nhập mã voucher.';
      setVoucherError(message);
      throw new Error(message);
    }
    if (!hotelId) {
      const message = 'Không tìm thấy khách sạn để áp dụng voucher.';
      setVoucherError(message);
      throw new Error(message);
    }

    setVoucherApplying(true);
    setVoucherError(null);
    try {
      const result = await bookingsApi.validateVoucher(hotelId, {
        code: normalized,
        roomTypeId: roomId || undefined,
        subtotal: amount,
      });
      setAppliedVoucher(result);
      setVoucherCode(result.voucher.code);
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      setAppliedVoucher(null);
      setVoucherError(message);
      throw error;
    } finally {
      setVoucherApplying(false);
    }
  }, [amount, hotelId, roomId]);

  const handleApplyVoucher = useCallback((code?: string) => {
    void validateVoucherCode(code || voucherCode).catch(() => {});
  }, [validateVoucherCode, voucherCode]);

  const handleRemoveVoucher = useCallback(() => {
    setAppliedVoucher(null);
    setVoucherCode('');
    setVoucherError(null);
  }, []);

  const handleRoomPress = useCallback(async () => {
    if (!hotelId || !roomId) return;

    // Try to find room from API rooms list
    setRoomDetailLoading(true);
    try {
      const res = await hotelsApi.getRooms(hotelId, {
        bookingType: (getParamText(params.bookingType) as any) || undefined,
        checkIn: getParamText(params.checkIn) || undefined,
        checkOut: getParamText(params.checkOut) || undefined,
      });
      const found = res.data.find(r => String(r.id) === String(roomId));
      if (found) {
        setSelectedRoomForDetail(found);
      } else {
        // Fallback: construct minimal Room object from params
        setSelectedRoomForDetail({
          id: roomId,
          hotelId: hotelId,
          name: roomName,
          area: 0,
          beds: '',
          maxGuests: 2,
          images: roomImage ? [roomImage] : [],
          price: amount,
          originalPrice: amount,
          flashSale: false,
          remainingRooms: 1,
          paymentType: 'all',
        });
      }
    } catch {
      // Fallback on error
      setSelectedRoomForDetail({
        id: roomId,
        hotelId: hotelId,
        name: roomName,
        area: 0,
        beds: '',
        maxGuests: 2,
        images: roomImage ? [roomImage] : [],
        price: amount,
        originalPrice: amount,
        flashSale: false,
        remainingRooms: 1,
        paymentType: 'all',
      });
    } finally {
      setRoomDetailLoading(false);
    }
  }, [hotelId, roomId, params.bookingType, params.checkIn, params.checkOut, roomName, roomImage, amount]);

  const selectedPaymentMethod = PAYMENT_METHODS.find(method => method.id === selectedPaymentMethodId);
  const paymentActionLabel = !selectedPaymentMethodId
    ? 'Chọn thanh toán'
    : selectedPaymentMethodId === 'hotel'
      ? 'Đặt phòng'
      : 'Thanh toán';
  const savingActionLabel = selectedPaymentMethodId === 'hotel'
    ? 'Đang đặt phòng...'
    : 'Đang tạo QR...';
  const activePaymentId = paymentSession?.payment.id;
  const activePaymentExpiresAt = paymentSession?.payment.expiresAt;
  const activePaymentGraceExpiresAt = paymentSession?.payment.graceExpiresAt;

  useEffect(() => {
    if (!activePaymentId || confirmed) return;

    const updateCountdown = () => {
      setNow(Date.now());
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [
    activePaymentId,
    activePaymentExpiresAt,
    activePaymentGraceExpiresAt,
    confirmed,
  ]);

  const checkPaymentStatus = async (showLoading = false) => {
    if (!paymentSession || confirmed) return;

    if (showLoading) setCheckingPayment(true);
    try {
      const status = await bookingsApi.getPaymentStatus(paymentSession.booking.id);
      if (status.isPaid) {
        setConfirmedBookingId(paymentSession.booking.id);
        setConfirmedBookingCode(paymentSession.booking.code);
        setConfirmed(true);
        return;
      }

      setPaymentSession(current => current
        ? {
          ...current,
          support: status.support || current.support,
          payment: {
            ...current.payment,
            status: status.paymentStatus,
            phase: status.paymentPhase,
            expiresAt: status.expiresAt || current.payment.expiresAt,
            graceExpiresAt: status.graceExpiresAt || current.payment.graceExpiresAt,
            paidAt: status.paidAt,
            failureReason: status.failureReason,
            failureMessage: status.failureMessage,
          },
        }
        : current);

      if (status.canCreateNewQr) {
        setPaymentError(status.failureMessage || 'Không ghi nhận được thanh toán trong thời gian tự động. Quý khách có thể tạo QR mới hoặc gửi khiếu nại để được hỗ trợ.');
      }
    } catch (error) {
      if (showLoading) setPaymentError(getErrorMessage(error));
    } finally {
      if (showLoading) setCheckingPayment(false);
    }
  };

  useEffect(() => {
    if (!paymentSession || confirmed) return;

    let active = true;
    const poll = async () => {
      try {
        const status = await bookingsApi.getPaymentStatus(paymentSession.booking.id);
        if (active && status.isPaid) {
          setConfirmedBookingId(paymentSession.booking.id);
          setConfirmedBookingCode(paymentSession.booking.code);
          setConfirmed(true);
          return;
        }

        if (active) {
          setPaymentSession(current => current
            ? {
              ...current,
              support: status.support || current.support,
              payment: {
                ...current.payment,
                status: status.paymentStatus,
                phase: status.paymentPhase,
                expiresAt: status.expiresAt || current.payment.expiresAt,
                graceExpiresAt: status.graceExpiresAt || current.payment.graceExpiresAt,
                paidAt: status.paidAt,
                failureReason: status.failureReason,
                failureMessage: status.failureMessage,
              },
            }
            : current);

          if (status.canCreateNewQr) {
            setPaymentError(status.failureMessage || 'Không ghi nhận được thanh toán trong thời gian tự động. Quý khách có thể tạo QR mới hoặc gửi khiếu nại để được hỗ trợ.');
          }
        }
      } catch { }
    };

    void poll();
    const timer = setInterval(poll, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [paymentSession, confirmed]);

  const handleConfirmBooking = async () => {
    if (saving) return;
    if (!selectedPaymentMethodId) {
      setShowPaymentMethodSheet(true);
      return;
    }

    const selectedMethodId = selectedPaymentMethodId;
    const apiPaymentMethod = selectedMethodId === 'hotel' ? 'PAY_AT_HOTEL' : 'VIETQR';

    setSaving(true);
    setPaymentError(null);
    try {
      let voucherCodeForBooking = appliedVoucher?.voucher.code;
      if (!voucherCodeForBooking && voucherCode.trim()) {
        const validatedVoucher = await validateVoucherCode(voucherCode);
        voucherCodeForBooking = validatedVoucher.voucher.code;
      }

      console.log('[handleConfirmBooking] Creating booking with:', {
        hotelId,
        roomId,
        paymentMethod: apiPaymentMethod,
        amount,
        voucherCode: voucherCodeForBooking,
      });

      const result = await bookingsApi.create({
        hotelId: hotelId || '',
        roomId: roomId || '',
        paymentMethod: apiPaymentMethod,
        bookingType,
        checkIn: toBookingIso(checkIn),
        checkOut: toBookingIso(checkOut),
        guests: 1,
        amount,
        durationValue: Number(getParamText(params.hours)) || undefined,
        customerName,
        customerPhone: customerPhone === 'Chưa cập nhật' ? undefined : customerPhone,
        customerEmail: customerEmail || undefined,
        voucherCode: voucherCodeForBooking || undefined,
      });

      console.log('[handleConfirmBooking] API Response:', {
        bookingId: result.booking?.id,
        bookingCode: result.booking?.code,
        paymentMethod: result.payment?.method,
        paymentId: result.payment?.id,
        vietQrUrl: result.payment?.vietQrUrl ? 'present' : 'missing',
        paymentStatus: result.payment?.status,
      });

      if (!result.booking?.id) {
        throw new Error('Không thể tạo đặt phòng.');
      }

      setConfirmedBookingId(result.booking.id);
      setConfirmedBookingCode(result.booking.code);
      setConfirmedPaymentMethod(selectedMethodId);

      if (selectedMethodId === 'hotel') {
        setConfirmed(true);
        return;
      }

      if (!result.payment) {
        const debugMsg = `No payment object returned. Full response: ${JSON.stringify(result)}`;
        console.error('[handleConfirmBooking] Missing payment object:', debugMsg);
        throw new Error('Không thể tạo thông tin thanh toán. Vui lòng thử lại.');
      }

      if (result.payment.method !== 'VIETQR') {
        console.error('[handleConfirmBooking] Wrong payment method:', result.payment.method);
        throw new Error('Không thể tạo mã QR thanh toán. Vui lòng thử lại.');
      }

      console.log('[handleConfirmBooking] QR created successfully, showing payment screen');

      const createdAt = Date.now();
      const qrSession: CreateQrBookingResponse = {
        ...result,
        payment: result.payment,
      };

      setPaymentSession(withLocalQrCountdown(qrSession, createdAt));
      setNow(createdAt);
    } catch (error) {
      const message = getErrorMessage(error);
      setPaymentError(message);
      Alert.alert('Không thể tạo thanh toán', message);
      console.error('[handleConfirmBooking] Error details:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectPaymentMethod = (methodId: PaymentMethodId) => {
    const method = PAYMENT_METHODS.find(item => item.id === methodId);
    if (!method?.available) return;

    setSelectedPaymentMethodId(methodId);
    setShowPaymentMethodSheet(false);
  };

  const handlePaymentButtonPress = () => {
    if (!selectedPaymentMethodId) {
      setShowPaymentMethodSheet(true);
      return;
    }

    handleConfirmBooking();
  };

  const handleCreateNewQr = useCallback(async () => {
    if (!paymentSession || creatingNewQr) return;

    setCreatingNewQr(true);
    setPaymentError(null);
    try {
      const result = await bookingsApi.createNewQr(paymentSession.booking.id);
      const createdAt = Date.now();
      setPaymentSession(withLocalQrCountdown(result, createdAt));
      setConfirmedBookingId(result.booking.id);
      setConfirmedBookingCode(result.booking.code);
      setExpiredNoticePaymentId(null);
      setNow(createdAt);
    } catch (error) {
      const message = getErrorMessage(error);
      setPaymentError(message);
      Alert.alert('Không thể tạo QR mới', message);
    } finally {
      setCreatingNewQr(false);
    }
  }, [creatingNewQr, paymentSession]);

  useEffect(() => {
    if (!paymentSession || confirmed) return;

    const paymentId = paymentSession.payment.id;
    const paymentPhase = getLocalPaymentPhase(paymentSession.payment, now);
    if (paymentPhase !== 'EXPIRED_FINAL' || expiredNoticePaymentId === paymentId) return;

    setExpiredNoticePaymentId(paymentId);
    setPaymentError('Mã QR đã hết hạn. Vui lòng nhận mã QR mới để tiếp tục thanh toán.');
    Alert.alert(
      'Mã QR đã hết hạn',
      'Thời gian thanh toán đã kết thúc. Vui lòng nhận mã QR mới để tiếp tục thanh toán.',
      [
        { text: 'Để sau', style: 'cancel' },
        { text: 'Nhận mã QR mới', onPress: handleCreateNewQr },
      ],
    );
  }, [paymentSession, now, confirmed, expiredNoticePaymentId, handleCreateNewQr]);

  if (confirmed) {
    return (
      <BookingSuccessView
        isPayAtHotel={confirmedPaymentMethod === 'hotel'}
        confirmedBookingCode={confirmedBookingCode || paymentSession?.booking.code || ''}
        hotelName={hotelName}
        confirmedBookingId={confirmedBookingId}
        isWebLayout={isWebLayout}
        insets={insets}
      />
    );
  }

  if (paymentSession) {
    return (
      <BookingQrPaymentView
        paymentSession={paymentSession}
        setPaymentSession={setPaymentSession}
        now={now}
        isWebLayout={isWebLayout}
        insets={insets}
        paymentError={paymentError}
        creatingNewQr={creatingNewQr}
        handleCreateNewQr={handleCreateNewQr}
      />
    );
  }

  return (
    <>
      <BookingFormView
        goBack={goBack}
        isWebLayout={isWebLayout}
        insets={insets}
        hotelName={hotelName}
        roomName={roomName}
        hotelAddress={hotelAddress}
        roomImage={roomImage}
        durationLabel={durationLabel}
        checkIn={checkIn}
        checkOut={checkOut}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        customerName={customerName}
        paymentBreakdown={paymentBreakdown}
        cancellationDeadline={cancellationDeadline}
        availableVouchers={sortedAvailableVouchers}
        collectedVoucherCodes={collectedVoucherCodes}
        voucherCode={voucherCode}
        appliedVoucher={appliedVoucher}
        voucherLoading={voucherLoading}
        voucherApplying={voucherApplying}
        voucherError={voucherError}
        voucherDiscountText={voucherDiscountText}
        finalPrice={finalPrice}
        onVoucherCodeChange={handleVoucherCodeChange}
        onApplyVoucher={handleApplyVoucher}
        onRemoveVoucher={handleRemoveVoucher}
        showPaymentMethodSheet={showPaymentMethodSheet}
        setShowPaymentMethodSheet={setShowPaymentMethodSheet}
        selectedPaymentMethod={selectedPaymentMethod}
        selectedPaymentMethodId={selectedPaymentMethodId}
        handleSelectPaymentMethod={handleSelectPaymentMethod}
        saving={saving}
        paymentActionLabel={paymentActionLabel}
        savingActionLabel={savingActionLabel}
        handlePaymentButtonPress={handlePaymentButtonPress}
        onRoomPress={handleRoomPress}
      />

      {/* Loading overlay khi đang fetch thông tin phòng */}
      {roomDetailLoading && (
        <Modal transparent animationType="fade" visible>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 28, alignItems: 'center', gap: 12 }}>
              <ActivityIndicator size="large" color="#85c2a4" />
              <Text style={{ color: '#25252d', fontWeight: '700', fontSize: 15 }}>Đang tải chi tiết phòng...</Text>
            </View>
          </View>
        </Modal>
      )}

      {/* Modal chi tiết phòng */}
      {selectedRoomForDetail && (
        <RoomDetailModal
          room={selectedRoomForDetail}
          bookingType={getParamText(params.bookingType) || bookingType}
          checkIn={getParamText(params.checkIn) || ''}
          checkOut={getParamText(params.checkOut) || ''}
          hours={getParamText(params.hours) || ''}
          onClose={() => setSelectedRoomForDetail(null)}
          onBook={() => setSelectedRoomForDetail(null)}
          insets={insets}
          isWebLayout={isWebLayout}
          imageWidth={isWebLayout ? Math.min(Math.max(width - 380, 500), 900) : width}
        />
      )}
    </>
  );
}

