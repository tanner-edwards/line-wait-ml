import {
  CombinedResponse,
  ParkData,
  ParkError,
  ParkSlug,
  PARKS,
  Ride,
} from './types';

export function shapeParkData(
  parkSlug: ParkSlug,
  rides: Ride[],
  lastUpdated: string
): ParkData {
  return {
    park: PARKS[parkSlug].name,
    lastUpdated,
    rides,
  };
}

export function shapeParkError(
  parkSlug: ParkSlug,
  errorCode: string
): ParkError {
  return {
    park: PARKS[parkSlug].name,
    lastUpdated: null,
    rides: [],
    error: errorCode,
  };
}

export function shapeCombined(
  entries: (ParkData | ParkError)[]
): CombinedResponse {
  return { parks: entries };
}
