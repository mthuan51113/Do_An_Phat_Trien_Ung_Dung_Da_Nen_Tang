import * as hotelService from './hotels.service';
import type { LocationDistrict, LocationProvince } from '../models/hotel.model';
import type { VietnamProvinceApiItem } from '../models/location.model';

const VIETNAM_PROVINCES_API = 'https://provinces.open-api.vn/api/?depth=3';
const VIETNAM_PROVINCES_TIMEOUT_MS = 3000;

const compareVietnamese = (a: string, b: string) => a.localeCompare(b, 'vi', { sensitivity: 'base' });

const stripAdministrativePrefix = (value: string) =>
  value
    .replace(/^(Tỉnh|Thành phố|TP\.?|Quận|Huyện|Thị xã|Phường|Xã|Thị trấn)\s+/i, '')
    .trim();

const normalizeKey = (value: string) =>
  stripAdministrativePrefix(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(tinh|thanh pho|tp\.?|quan|huyen|thi xa|phuong|xa|thi tran)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const buildDistrictMap = (districts: LocationDistrict[]) => {
  const districtMap = new Map<string, LocationDistrict>();

  districts.forEach((district) => {
    districtMap.set(normalizeKey(district.name), district);
  });

  return districtMap;
};

const mergeDistricts = (
  apiDistricts: VietnamProvinceApiItem['districts'],
  hotelDistricts: LocationDistrict[],
): LocationDistrict[] => {
  const hotelDistrictMap = buildDistrictMap(hotelDistricts);
  const mergedDistrictKeys = new Set<string>();

  const districtsFromApi = (apiDistricts ?? []).map((district) => {
    const matchedHotelDistrict = hotelDistrictMap.get(normalizeKey(district.name));
    mergedDistrictKeys.add(normalizeKey(district.name));

    const hotelWardMap = new Map(
      (matchedHotelDistrict?.wards ?? []).map((ward) => [normalizeKey(ward.name), ward.count]),
    );

    return {
      name: stripAdministrativePrefix(district.name),
      count: matchedHotelDistrict?.count ?? 0,
      wards: (district.wards ?? []).map((ward) => ({
        name: stripAdministrativePrefix(ward.name),
        count: hotelWardMap.get(normalizeKey(ward.name)) ?? 0,
      })),
    };
  });

  const hotelOnlyDistricts = hotelDistricts.filter(
    (district) => !mergedDistrictKeys.has(normalizeKey(district.name)),
  );

  return [...districtsFromApi, ...hotelOnlyDistricts].sort((a, b) => compareVietnamese(a.name, b.name));
};

const fetchVietnamProvinces = async (): Promise<VietnamProvinceApiItem[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIETNAM_PROVINCES_TIMEOUT_MS);

  try {
    const response = await fetch(VIETNAM_PROVINCES_API, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Could not load Vietnam provinces: ${response.status}`);
    }

    return response.json() as Promise<VietnamProvinceApiItem[]>;
  } finally {
    clearTimeout(timeout);
  }
};

export const findCustomerLocations = async (): Promise<LocationProvince[]> => {
  const hotelLocations = await hotelService.findHotelLocations();

  try {
    const provinceItems = await fetchVietnamProvinces();
    const hotelProvinceMap = new Map(
      hotelLocations.map((province) => [normalizeKey(province.name), province]),
    );

    return provinceItems
      .map((province) => {
        const provinceName = stripAdministrativePrefix(province.name);
        const matchedHotelProvince = hotelProvinceMap.get(normalizeKey(province.name));

        return {
          name: provinceName,
          count: matchedHotelProvince?.count ?? 0,
          districts: mergeDistricts(province.districts, matchedHotelProvince?.districts ?? []),
        };
      })
      .sort((a, b) => compareVietnamese(a.name, b.name));
  } catch (error) {
    console.warn('[customer/location] Falling back to hotel locations:', error);
    return hotelLocations;
  }
};
