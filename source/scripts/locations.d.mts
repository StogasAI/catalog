export type Location = { name: string; parentIds: string[] };
export type Locations = Record<string, Location>;
/** Each place with the places that contain it, and with the places inside it, in order. */
export type PlaceIndex = {
	within: ReadonlyMap<string, readonly string[]>;
	inside: ReadonlyMap<string, readonly string[]>;
};

export const WORLD: 'world';
export function placeIndex(locations: Locations): PlaceIndex;
export function isLocation(places: PlaceIndex, location: string): boolean;
export function locationWithin(places: PlaceIndex, location: string): readonly string[];
