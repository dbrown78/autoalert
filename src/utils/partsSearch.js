const AMAZON_TAG = 'odinai-20';

export function buildPartsLinks(partName, vehicle) {
  const hasVehicle = vehicle?.year && vehicle?.make && vehicle?.model;
  const vehiclePrefix = hasVehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model} `
    : '';

  const amazonQ = encodeURIComponent(vehiclePrefix + partName);
  const ebayQ = encodeURIComponent(vehiclePrefix + partName);

  const rockAutoBase = hasVehicle
    ? `https://www.rockauto.com/en/catalog/${encodeURIComponent(vehicle.make.toLowerCase())},${encodeURIComponent(vehicle.model.toLowerCase())},${vehicle.year}/`
    : `https://www.rockauto.com/en/partsearch/?romatch=1&rrword=${encodeURIComponent(partName)}`;

  return [
    {
      label: 'Amazon',
      sublabel: 'Prime eligible',
      url: `https://www.amazon.com/s?k=${amazonQ}&tag=${AMAZON_TAG}`,
    },
    {
      label: 'RockAuto',
      sublabel: 'Wholesale prices',
      url: rockAutoBase,
    },
    {
      label: 'eBay Motors',
      sublabel: 'OEM & aftermarket',
      url: `https://www.ebay.com/sch/i.html?_nkw=${ebayQ}&_sacat=6030`,
    },
    {
      label: 'car-parts.com',
      sublabel: 'Used & salvage',
      url: `https://www.car-parts.com/search?q=${encodeURIComponent(partName)}`,
    },
  ];
}
