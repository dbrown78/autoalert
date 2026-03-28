const AMAZON_TAG = 'odinai-20';

export function buildPartsLinks(partName, vehicle) {
  const hasVehicle = vehicle?.year && vehicle?.make && vehicle?.model;
  const vehiclePrefix = hasVehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model} `
    : '';

  const fullQuery = vehiclePrefix + partName;

  // RockAuto: part-search endpoint with vehicle + part keyword
  const rockAutoUrl = hasVehicle
    ? `https://www.rockauto.com/en/partsearch/?romatch=1&rrword=${encodeURIComponent(partName)}&yr=${vehicle.year}&make=${encodeURIComponent(vehicle.make.toLowerCase())}&model=${encodeURIComponent(vehicle.model.toLowerCase())}`
    : `https://www.rockauto.com/en/partsearch/?romatch=1&rrword=${encodeURIComponent(partName)}`;

  // eBay Motors: include vehicle in keyword, restrict to Parts & Accessories
  const ebayUrl = hasVehicle
    ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(fullQuery)}&_sacat=6030&LH_ItemCondition=3`
    : `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(partName)}&_sacat=6030`;

  // AutoZone: part search with vehicle context
  const autoZoneUrl = `https://www.autozone.com/searchresult?searchText=${encodeURIComponent(fullQuery)}`;

  return [
    {
      label: 'Amazon',
      sublabel: 'Prime eligible',
      url: `https://www.amazon.com/s?k=${encodeURIComponent(fullQuery)}&tag=${AMAZON_TAG}`,
    },
    {
      label: 'RockAuto',
      sublabel: 'Wholesale prices',
      url: rockAutoUrl,
    },
    {
      label: 'eBay Motors',
      sublabel: 'OEM & aftermarket',
      url: ebayUrl,
    },
    {
      label: 'AutoZone',
      sublabel: 'Same-day pickup',
      url: autoZoneUrl,
    },
  ];
}
