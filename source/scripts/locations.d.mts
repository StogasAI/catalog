export type LocationKind = 'world' | 'continent' | 'region' | 'union' | 'country' | 'subdivision';
export type Location = {
	name: string;
	/** Catalogs built before places had kinds have none. */
	kind?: LocationKind;
	description?: string;
	/**
	 * The ISO 3166-1 countries that a continent, region or union covers, including countries that
	 * the catalog does not list. Catalogs built before regions listed their countries have none.
	 */
	countries?: string[];
	parentIds: string[];
};
export type Locations = Record<string, Location>;
/**
 * Each place with the places that contain it, and with the places inside it, in order, each
 * region with the countries that it lists, and the locations that contain `none`: every place and
 * `none` itself.
 */
export type PlaceIndex = {
	within: ReadonlyMap<string, readonly string[]>;
	inside: ReadonlyMap<string, readonly string[]>;
	countries: ReadonlyMap<string, readonly string[]>;
	all: readonly string[];
};

export const WORLD: 'world';
export function isPlaceId(id: string): boolean;
export function placeIndex(locations: Locations): PlaceIndex;
export function isLocation(places: PlaceIndex, location: string): boolean;
export function locationWithin(places: PlaceIndex, location: string): readonly string[];
export function countriesIn(places: PlaceIndex, place: string): readonly string[];
