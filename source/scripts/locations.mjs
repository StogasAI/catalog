/**
 * The places that data handling names: world, the regions within it, and ISO 3166 countries and
 * their subdivisions. Each place but world lists the places that directly contain it, and a
 * continent, region or union lists every country that it covers, including countries that the
 * catalog does not list. A data handling location is a place, `unknown` when the provider does
 * not say where, or, for storage only, `none` when the provider keeps nothing. Nothing kept is kept
 * nowhere, so `none` lies within every place.
 */
export const WORLD = 'world';
const PLACE_ID = /^(?:[A-Z]{2}(?:-[A-Z0-9]{1,3})?|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/;
const COUNTRY = /^[A-Z]{2}$/;

/** Whether an ID has the form of a place: `unknown` and `none` are values, not places. */
export function isPlaceId(id) {
	return PLACE_ID.test(id) && id !== 'unknown' && id !== 'none';
}

/**
 * Each place with every place that contains it, and each place with every place inside it, each
 * list in order and holding the place itself, each region with the countries that it lists, and
 * the locations that contain `none`. Throws unless world contains every other place, no place
 * contains itself and no two IDs differ only in case.
 */
export function placeIndex(locations) {
	const own = (id) => Object.hasOwn(locations, id);
	if (!own(WORLD) || locations[WORLD].parentIds.length)
		throw new Error('Locations must have world, in no other place');
	const within = new Map();
	const visiting = new Set();
	const visit = (id) => {
		const found = within.get(id);
		if (found) return found;
		if (visiting.has(id)) throw new Error(`Location ${id} lies in itself`);
		visiting.add(id);
		const places = new Set([id]);
		for (const parentId of locations[id].parentIds) {
			if (!own(parentId)) throw new Error(`Location ${id} lies in unknown place ${parentId}`);
			for (const place of visit(parentId)) places.add(place);
		}
		visiting.delete(id);
		const list = [...places].sort(compare);
		within.set(id, list);
		return list;
	};
	const ids = Object.keys(locations).sort(compare);
	// A policy that names a place in the wrong case is told the place that it meant.
	const folded = new Map();
	for (const id of ids) {
		const { parentIds } = locations[id];
		if (!isPlaceId(id)) throw new Error(`Location ${JSON.stringify(id)} has an invalid ID`);
		const other = folded.get(id.toLowerCase());
		if (other) throw new Error(`Locations ${other} and ${id} differ only in case`);
		folded.set(id.toLowerCase(), id);
		if (id !== WORLD && !parentIds.length) throw new Error(`Location ${id} lies in no place`);
		if (new Set(parentIds).size !== parentIds.length)
			throw new Error(`Location ${id} repeats a parent`);
		visit(id);
	}
	const inside = new Map(ids.map((id) => [id, []]));
	for (const id of ids) for (const place of within.get(id)) inside.get(place).push(id);
	// Catalogs built before regions listed their countries have no lists.
	const countries = new Map(
		ids.flatMap((id) => (locations[id].countries ? [[id, locations[id].countries]] : []))
	);
	return { within, inside, countries, all: [...ids, 'none'].sort(compare) };
}

/** Whether a data handling location is a place that the index lists, or `unknown`. */
export function isLocation(places, location) {
	return location === 'unknown' || places.within.has(location);
}

/**
 * A data handling location and every place that contains it, in order, as policies read them.
 * A country that the catalog does not list lies in world, in each region that lists it and in the
 * places that contain those. `none` lies in every place, and `unknown` and any other place that
 * the catalog does not list hold only themselves.
 */
export function locationWithin(places, location) {
	const within = places.within.get(location);
	if (within) return within;
	if (location === 'none') return places.all;
	if (!COUNTRY.test(location)) return [location];
	const holding = new Set([location, WORLD]);
	for (const [region, countries] of places.countries)
		if (countries.includes(location))
			for (const place of places.within.get(region)) holding.add(place);
	return [...holding].sort(compare);
}

/**
 * The ISO 3166-1 countries in a place: those that a region lists, the catalog's or not, or else
 * those that the catalog lists inside the place, so a country is in itself and a subdivision holds
 * none.
 */
export function countriesIn(places, place) {
	return (
		places.countries.get(place) ?? (places.inside.get(place) ?? []).filter((id) => COUNTRY.test(id))
	);
}

function compare(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
