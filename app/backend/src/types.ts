export type ParkSlug = 'disneyland' | 'california-adventure';

export interface ParkInfo {
  id: string;
  name: string;
}

export const PARKS: Record<ParkSlug, ParkInfo> = {
  'disneyland': {
    id: '7340550b-c14d-4def-80bb-acdb51d49a66',
    name: 'Disneyland',
  },
  'california-adventure': {
    id: '832fcd51-ea19-4e77-85c7-75d5843b127c',
    name: 'Disney California Adventure',
  },
};

export const PARK_ORDER: ParkSlug[] = ['disneyland', 'california-adventure'];

// --- Raw Themeparks API shapes (only the fields we read) ---

export interface ThemeparksLiveEntity {
  id: string;
  name: string;
  entityType: string;
  status?: string;
  parentId?: string;
  queue?: {
    STANDBY?: { waitTime: number | null };
  };
}

export interface ThemeparksLiveResponse {
  id: string;
  name: string;
  liveData: ThemeparksLiveEntity[];
}

// --- Outgoing response shapes (the v0 contract) ---

export interface Ride {
  id: string;
  name: string;
  land: string;
  status: string;
  currentWait: number | null;
}

export interface ParkData {
  park: string;
  lastUpdated: string;
  rides: Ride[];
}

export interface ParkError {
  park: string;
  lastUpdated: null;
  rides: [];
  error: string;
}

export interface CombinedResponse {
  parks: (ParkData | ParkError)[];
}

export interface ErrorResponse {
  error: string;
  message: string;
  lastUpdated: null;
}
