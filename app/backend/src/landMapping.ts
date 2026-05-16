// Static map of Themeparks attraction UUIDs to their human-readable land name.
//
// The Themeparks v1 REST API does not model "lands" — every attraction's
// parentId points directly to the park, not to a land. So we maintain
// this lookup ourselves. Disney's lands are stable over years; the cost
// of hand-curation is low.
//
// When a new attraction opens, add it here. If a UUID isn't in the map,
// the resolver returns 'Other' as a graceful fallback.

import { ParkSlug } from './types';

export const DISNEYLAND_LANDS: Record<string, string> = {
  // Main Street, U.S.A.
  '11209961-2ac2-4f76-a11b-ed793939f796': 'Main Street, U.S.A.', // Key to Disneyland
  '1b23667a-d8fb-436d-8952-c3e3f2e56d13': 'Main Street, U.S.A.', // Great Moments with Mr. Lincoln
  '37858b2a-9c11-4ac6-9f8d-db7fa9088703': 'Main Street, U.S.A.', // The Disney Gallery
  '56d0bd6d-5106-4420-8f60-0005475c04c3': 'Main Street, U.S.A.', // Disneyland Monorail
  '05b17c11-fd4c-4b85-ab45-3e269dc56559': 'Main Street, U.S.A.', // Walt Disney - A Magical Life
  '6e2af074-3a67-4f38-9bcf-2f5a572c87df': 'Main Street, U.S.A.', // Opera House - Walt Disney - A Magical Life
  'bcfd1e17-3eab-4203-b597-6257a257d427': 'Main Street, U.S.A.', // Main Street Vehicles
  'e2d460e9-2bef-4613-b126-092ab7cb37e5': 'Main Street, U.S.A.', // Disneyland Railroad
  'f5bb0d14-7eee-4ede-9230-eb256ce3664c': 'Main Street, U.S.A.', // Main Street Cinema

  // Adventureland
  '106c1e5a-a5e7-42d7-96ab-bc100d8faf71': 'Adventureland', // Walt Disney's Enchanted Tiki Room
  '1b83fda8-d60e-48e4-9a3d-90ddcbcd1001': 'Adventureland', // Jungle Cruise
  '2aedc657-1ee2-4545-a1ce-14753f28cc66': 'Adventureland', // Indiana Jones™ Adventure
  'e27b1db8-9ec9-4f8b-9ca6-fd6377de66ee': 'Adventureland', // Adventureland Treehouse

  // New Orleans Square
  '82aeb29b-504a-416f-b13f-f41fa5b766aa': 'New Orleans Square', // Pirates of the Caribbean
  'ff52cb64-c1d5-4feb-9d43-5dbd429bac81': 'New Orleans Square', // Haunted Mansion

  // Frontierland
  '07952343-3498-404b-8337-734de9a185c1': 'Frontierland', // Pirate's Lair on Tom Sawyer Island
  '0de1413a-73ee-46cf-af2e-c491cc7c7d3b': 'Frontierland', // Big Thunder Mountain Railroad
  '6c30d5b0-8c0a-406f-9258-0b6c55d4a5e4': 'Frontierland', // Mark Twain Riverboat
  '835deb74-de54-4d7f-9dc4-dacab90fcb60': 'Frontierland', // Frontierland Shootin' Exposition
  'c9e39189-7e99-4e0a-97e0-4a0d5654d257': 'Frontierland', // Sailing Ship Columbia

  // Bayou Country (formerly Critter Country, rebranded with Tiana's Bayou Adventure)
  '52a8ef64-d54c-4974-883f-027c3026e3f1': 'Bayou Country', // The Many Adventures of Winnie the Pooh
  '5bd95ae8-181d-449c-8f04-a621e2448961': 'Bayou Country', // Davy Crockett's Explorer Canoes
  'a9076acd-7630-4bad-a8da-e6bd689ddcac': 'Bayou Country', // Tiana's Bayou Adventure

  // Fantasyland
  '3638ac09-9fce-4a43-8c79-8ebbe17afce2': 'Fantasyland', // "it's a small world"
  '4f0053e7-b8db-4833-b02f-35e1c91b4523': 'Fantasyland', // Snow White's Enchanted Wish
  '8e686e4c-f3db-4d9c-a185-2d54b1fa8899': 'Fantasyland', // Casey Jr. Circus Train
  '888525b0-5a6f-4b8e-9f07-b6a32812b04d': 'Fantasyland', // Bluey's Best Day Ever! at Fantasyland Theatre
  '90d5a091-478c-4df1-adfe-c605b4005013': 'Fantasyland', // Sleeping Beauty Castle Walkthrough
  '90ee50d4-7cc9-4824-b29d-2aac801acc29': 'Fantasyland', // Pinocchio's Daring Journey
  '9d401ad3-49b2-469f-ac73-93eb429428fb': 'Fantasyland', // Mr. Toad's Wild Ride
  'a07f3110-013e-43bb-a182-e66bb8b5e28d': 'Fantasyland', // Alice in Wonderland
  'c23af6ba-8515-406a-8a48-d0818ba0bfc9': 'Fantasyland', // Peter Pan's Flight
  'c2997e65-6db0-413f-a2db-ee995711d931': 'Fantasyland', // Fortune Tellers
  'cb929138-d77a-4dd2-983c-f651bbd1bd92': 'Fantasyland', // Storybook Land Canal Boats
  'cc980e8e-192f-48b6-848c-27784084e54b': 'Fantasyland', // Dumbo the Flying Elephant
  'e0cfed11-96d7-40f3-907f-5cfed172592a': 'Fantasyland', // Mad Tea Party
  'f7904912-3f08-4563-b99e-fd59f43cc9f2': 'Fantasyland', // King Arthur Carrousel
  'faaa8be9-cc1e-4535-ac20-04a535654bd0': 'Fantasyland', // Matterhorn Bobsleds

  // Mickey's Toontown
  '59647168-d239-4161-8b24-92eb128e96fb': "Mickey's Toontown", // Chip 'n' Dale's GADGETcoaster
  '6ce9cdd1-0a43-459e-83cd-f4cace9cfa7b': "Mickey's Toontown", // Roger Rabbit's Car Toon Spin
  '87387057-47ab-4d0b-8eed-2e6c9d23577b': "Mickey's Toontown", // Mickey's House and Meet Mickey Mouse
  'b0eca3d3-a519-47f9-a5a7-9911126da2df': "Mickey's Toontown", // Goofy's How-to-Play Yard
  'c02fb82d-0860-4e95-8c61-899fa594d20e': "Mickey's Toontown", // Minnie's House
  'ca32ef8a-ae0d-4c24-bf4f-e59192122e01': "Mickey's Toontown", // Donald's Duck Pond
  'cd670bff-81d1-4f34-8676-7bafdf49220a': "Mickey's Toontown", // Mickey & Minnie's Runaway Railway

  // Tomorrowland
  '1da85181-bf0f-4ccc-b98e-243142f7347b': 'Tomorrowland', // Autopia
  '64d44aaa-6857-4693-b24b-bcff6c6dcfa1': 'Tomorrowland', // Finding Nemo Submarine Voyage
  '6c225598-91c9-44a3-95e2-7c423475db61': 'Tomorrowland', // Astro Orbitor
  '88197808-3c56-4198-a5a4-6066541251cf': 'Tomorrowland', // Buzz Lightyear Astro Blasters
  '9167db1d-e5e7-46da-a07f-ae30a87bc4c4': 'Tomorrowland', // Hyperspace Mountain
  'cc718d11-fa15-44ee-87d0-ded989ad61bc': 'Tomorrowland', // Star Tours - The Adventures Continue

  // Star Wars: Galaxy's Edge
  '34b1d70f-11c4-42df-935e-d5582c9f1a8e': "Star Wars: Galaxy's Edge", // Star Wars: Rise of the Resistance
  'b2c2549c-e9da-4fdd-98ea-1dcff596fed7': "Star Wars: Galaxy's Edge", // Millennium Falcon: Smugglers Run
};

export const CALIFORNIA_ADVENTURE_LANDS: Record<string, string> = {
  // Hollywood Land (includes the Hyperion Theater / Disney Animation building)
  '40524fba-5d84-49e7-9204-f493dbe2d5a4': 'Hollywood Land', // Monsters, Inc. Mike & Sulley to the Rescue!
  '44c1f655-25d3-440c-b1a8-db736a12b105': 'Hollywood Land', // Sorcerer's Workshop
  '7561bcd8-18ea-4e3f-89d5-c905b7ba3d42': 'Hollywood Land', // Turtle Talk with Crush
  '8f586a2f-cef5-46d3-b822-fd622c4e9e33': 'Hollywood Land', // Mickey's PhilharMagic
  'd2aa0987-49a2-45dc-a635-3a8bf7401230': 'Hollywood Land', // Animation Academy

  // Avengers Campus
  '2295351d-ce6b-4c04-92d5-5b416372c5b5': 'Avengers Campus', // WEB SLINGERS: A Spider-Man Adventure
  'b7678dab-5544-48d5-8fdc-c1a0127cfbcd': 'Avengers Campus', // Guardians of the Galaxy - Mission: BREAKOUT!

  // Cars Land
  '46097afe-a1ea-4807-93d3-14d14f36e55f': 'Cars Land', // Mater's Junkyard Jamboree
  '7a09a2f0-e226-4f3e-86f8-2598ab67ec44': 'Cars Land', // Luigi's Rollickin' Roadsters
  'c60c768b-3461-465c-8f4f-b44b087506fc': 'Cars Land', // Radiator Springs Racers

  // San Fransokyo Square (formerly Pacific Wharf, rebranded 2023)
  'eb77ee1f-3207-44fd-acfc-d7bc18602007': 'San Fransokyo Square', // The Bakery Tour

  // Pixar Pier
  '1d24dd7a-372b-4195-8ad0-ba9679d72b08': 'Pixar Pier', // Games of Pixar Pier
  '388ad3f1-5cf5-4a9d-8d0e-6dfb817d7822': 'Pixar Pier', // Jessie's Critter Carousel
  '4ca6cdbf-4c5f-45bf-b0dc-db83393ec208': 'Pixar Pier', // Pixar Pal-A-Round – Non-Swinging
  '528016ef-db24-47fa-a0f2-b6d26d61e29f': 'Pixar Pier', // Pixar Pal-A-Round - Swinging
  '5d07a2b1-49ca-4de7-9d32-6d08edf69b08': 'Pixar Pier', // Incredicoaster
  '6d876f4c-c3ff-4ae3-a2d8-d4b831e1039b': 'Pixar Pier', // Inside Out Emotional Whirlwind
  '86ab3069-110d-49c5-a7e7-29ddf28695a6': 'Pixar Pier', // Toy Story Midway Mania!

  // Paradise Gardens Park
  '10a5fc6f-5ad3-414b-9bdd-e6bae097b6ad': 'Paradise Gardens Park', // Golden Zephyr
  '4f5b28d0-b78e-482b-8e2e-1f90756d6220': 'Paradise Gardens Park', // Silly Symphony Swings
  'c8a4b7b1-c1b2-4dfe-b73c-4e834b4a73db': 'Paradise Gardens Park', // Jumpin' Jellyfish
  'e1fbc7a1-2cd1-4282-b373-ac11d9d9d38a': 'Paradise Gardens Park', // The Little Mermaid - Ariel's Undersea Adventure
  'f44a5072-3cda-4c7c-8574-33ad09d16cca': 'Paradise Gardens Park', // Goofy's Sky School

  // Grizzly Peak
  '77f205a4-d482-4d91-a5ff-71e54a086ad2': 'Grizzly Peak', // Soarin' Over California
  'b1d285a7-2444-4a7c-b7bb-d2d4d6428a85': 'Grizzly Peak', // Grizzly River Run
  'c9803366-6f37-4406-82af-7692357e3ca9': 'Grizzly Peak', // Redwood Creek Challenge Trail
};

export function getLandMap(parkSlug: ParkSlug): Record<string, string> {
  if (parkSlug === 'disneyland') return DISNEYLAND_LANDS;
  return CALIFORNIA_ADVENTURE_LANDS;
}
