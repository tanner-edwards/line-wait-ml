// Per-ride illustration slot. Rides with art in assets/ride-icons/ show it;
// everything else falls back to a generic glyph so list rows stay aligned
// while the icon set is still being drawn.

import React from 'react';
import { Image, ImageSourcePropType, View } from 'react-native';
import { FerrisWheel } from 'lucide-react-native';
import { colors } from '../../theme/tokens';

// Master switch — false hides icons everywhere (rec cards, tiles, Discover
// rows, detail header). Layouts collapse cleanly when this renders null; the
// detail header also hides its divider.
export const SHOW_RIDE_ICONS = true;

// Keyed by themeparks UUID (ride.id). Files are named after the ride's
// ride_metadata.json key. 256px art — the largest slot is 64pt (192px @3x).
const RIDE_ICONS: Record<string, ImageSourcePropType> = {
  'ff52cb64-c1d5-4feb-9d43-5dbd429bac81': require('../../../assets/ride-icons/dl_haunted_mansion.png'),
  '9167db1d-e5e7-46da-a07f-ae30a87bc4c4': require('../../../assets/ride-icons/dl_space_mountain.png'),
  'e0cfed11-96d7-40f3-907f-5cfed172592a': require('../../../assets/ride-icons/dl_mad_tea_party.png'),
  '82aeb29b-504a-416f-b13f-f41fa5b766aa': require('../../../assets/ride-icons/dl_pirates.png'),
  '0de1413a-73ee-46cf-af2e-c491cc7c7d3b': require('../../../assets/ride-icons/dl_big_thunder.png'),
  '2aedc657-1ee2-4545-a1ce-14753f28cc66': require('../../../assets/ride-icons/dl_indiana_jones.png'),
  '1b83fda8-d60e-48e4-9a3d-90ddcbcd1001': require('../../../assets/ride-icons/dl_jungle_cruise.png'),
  '52a8ef64-d54c-4974-883f-027c3026e3f1': require('../../../assets/ride-icons/dl_winnie_the_pooh.png'),
  'a9076acd-7630-4bad-a8da-e6bd689ddcac': require('../../../assets/ride-icons/dl_tianas_bayou.png'),
  // Railroad has no posted wait so it isn't in the app today — mapped for when it is.
  'e2d460e9-2bef-4613-b126-092ab7cb37e5': require('../../../assets/ride-icons/dl_disneyland_railroad.png'),
  'cc980e8e-192f-48b6-848c-27784084e54b': require('../../../assets/ride-icons/dl_dumbo.png'),
  '3638ac09-9fce-4a43-8c79-8ebbe17afce2': require('../../../assets/ride-icons/dl_its_a_small_world.png'),
  'f7904912-3f08-4563-b99e-fd59f43cc9f2': require('../../../assets/ride-icons/dl_king_arthur_carrousel.png'),
  'faaa8be9-cc1e-4535-ac20-04a535654bd0': require('../../../assets/ride-icons/dl_matterhorn.png'),
  '9d401ad3-49b2-469f-ac73-93eb429428fb': require('../../../assets/ride-icons/dl_mr_toad.png'),
  'a07f3110-013e-43bb-a182-e66bb8b5e28d': require('../../../assets/ride-icons/dl_alice.png'),
  '8e686e4c-f3db-4d9c-a185-2d54b1fa8899': require('../../../assets/ride-icons/dl_casey_jr.png'),
  'c23af6ba-8515-406a-8a48-d0818ba0bfc9': require('../../../assets/ride-icons/dl_peter_pan.png'),
  'b2c2549c-e9da-4fdd-98ea-1dcff596fed7': require('../../../assets/ride-icons/dl_smugglers_run.png'),
  '34b1d70f-11c4-42df-935e-d5582c9f1a8e': require('../../../assets/ride-icons/dl_rise_of_resistance.png'),
  '90ee50d4-7cc9-4824-b29d-2aac801acc29': require('../../../assets/ride-icons/dl_pinocchio.png'),
  '4f0053e7-b8db-4833-b02f-35e1c91b4523': require('../../../assets/ride-icons/dl_snow_white.png'),
  'cb929138-d77a-4dd2-983c-f651bbd1bd92': require('../../../assets/ride-icons/dl_storybook_canal.png'),
  '59647168-d239-4161-8b24-92eb128e96fb': require('../../../assets/ride-icons/dl_chip_dale_gadget.png'),
  'cd670bff-81d1-4f34-8676-7bafdf49220a': require('../../../assets/ride-icons/dl_mickey_minnie_runaway.png'),
  '6ce9cdd1-0a43-459e-83cd-f4cace9cfa7b': require('../../../assets/ride-icons/dl_roger_rabbit.png'),
  '1da85181-bf0f-4ccc-b98e-243142f7347b': require('../../../assets/ride-icons/dl_autopia.png'),
  '88197808-3c56-4198-a5a4-6066541251cf': require('../../../assets/ride-icons/dl_buzz_lightyear.png'),
  '64d44aaa-6857-4693-b24b-bcff6c6dcfa1': require('../../../assets/ride-icons/dl_finding_nemo_subs.png'),
  '6c225598-91c9-44a3-95e2-7c423475db61': require('../../../assets/ride-icons/dl_astro_orbitor.png'),
  'cc718d11-fa15-44ee-87d0-ded989ad61bc': require('../../../assets/ride-icons/dl_star_tours.png'),
  '5bd95ae8-181d-449c-8f04-a621e2448961': require('../../../assets/ride-icons/dl_davy_crockett_canoes.png'),
  // Disney California Adventure
  'b7678dab-5544-48d5-8fdc-c1a0127cfbcd': require('../../../assets/ride-icons/dca_guardians.png'),
  '40524fba-5d84-49e7-9204-f493dbe2d5a4': require('../../../assets/ride-icons/dca_monsters_inc.png'),
  '2295351d-ce6b-4c04-92d5-5b416372c5b5': require('../../../assets/ride-icons/dca_webslingers.png'),
  'c60c768b-3461-465c-8f4f-b44b087506fc': require('../../../assets/ride-icons/dca_radiator_springs.png'),
  '46097afe-a1ea-4807-93d3-14d14f36e55f': require('../../../assets/ride-icons/dca_maters.png'),
  '7a09a2f0-e226-4f3e-86f8-2598ab67ec44': require('../../../assets/ride-icons/dca_luigis.png'),
  'e1fbc7a1-2cd1-4282-b373-ac11d9d9d38a': require('../../../assets/ride-icons/dca_little_mermaid.png'),
  '10a5fc6f-5ad3-414b-9bdd-e6bae097b6ad': require('../../../assets/ride-icons/dca_golden_zephyr.png'),
  'c8a4b7b1-c1b2-4dfe-b73c-4e834b4a73db': require('../../../assets/ride-icons/dca_jumpin_jellyfish.png'),
  '4f5b28d0-b78e-482b-8e2e-1f90756d6220': require('../../../assets/ride-icons/dca_silly_symphony.png'),
  '5d07a2b1-49ca-4de7-9d32-6d08edf69b08': require('../../../assets/ride-icons/dca_incredicoaster.png'),
  '86ab3069-110d-49c5-a7e7-29ddf28695a6': require('../../../assets/ride-icons/dca_toy_story_midway.png'),
  '528016ef-db24-47fa-a0f2-b6d26d61e29f': require('../../../assets/ride-icons/dca_pixar_pal_around.png'),
  '6d876f4c-c3ff-4ae3-a2d8-d4b831e1039b': require('../../../assets/ride-icons/dca_inside_out.png'),
  '388ad3f1-5cf5-4a9d-8d0e-6dfb817d7822': require('../../../assets/ride-icons/dca_jessies_critter.png'),
  '77f205a4-d482-4d91-a5ff-71e54a086ad2': require('../../../assets/ride-icons/dca_soarin.png'),
  'b1d285a7-2444-4a7c-b7bb-d2d4d6428a85': require('../../../assets/ride-icons/dca_grizzly_river.png'),
};

// Seasonal overlays. Disney renames the ride while the overlay runs (themeparks
// reports "Haunted Mansion Holiday"), so the live name is the switch — no dates.
const SEASONAL_ICONS: Record<string, { nameIncludes: string; source: ImageSourcePropType }> = {
  'ff52cb64-c1d5-4feb-9d43-5dbd429bac81': {
    nameIncludes: 'Holiday',
    source: require('../../../assets/ride-icons/dl_haunted_mansion_holiday.png'),
  },
};

// Every icon is exported with a 16px transparent margin on its 256px canvas.
// Drawing the image at 256/224 of the slot lets the art itself fill the slot
// edge to edge — bigger art, same layout footprint.
const ART_SCALE = 256 / 224;

// Down / Closed / Refurbishment — fades the art to match the grayed ride name.
const DIMMED_OPACITY = 0.4;

interface Props {
  rideId: string;
  /** Live ride name — picks the seasonal variant when the overlay is running. */
  rideName?: string;
  size?: number;
  /** Ride isn't operating — fade the art. */
  dimmed?: boolean;
}

export function RideIcon({ rideId, rideName, size = 40, dimmed = false }: Props): React.ReactElement | null {
  if (!SHOW_RIDE_ICONS) return null;
  const seasonal = SEASONAL_ICONS[rideId];
  const art = seasonal && rideName?.includes(seasonal.nameIncludes)
    ? seasonal.source
    : RIDE_ICONS[rideId];
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity: dimmed ? DIMMED_OPACITY : 1 }} testID={`ride-icon-${rideId}`}>
      {art ? (
        <Image source={art} style={{ width: size * ART_SCALE, height: size * ART_SCALE }} resizeMode="contain" />
      ) : (
        <FerrisWheel size={size * 0.8} color={colors.go} strokeWidth={1.75} />
      )}
    </View>
  );
}
