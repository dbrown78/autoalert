// utils/partsSearch.js
// Builds search URLs for discount auto parts sites
// Usage: import { buildPartsLinks } from '../utils/partsSearch';

export const buildPartsLinks = (partName, vehicle = {}) => {
  const { year = '', make = '', model = '' } = vehicle;
  const vehicleStr = [year, make, model].filter(Boolean).join(' ');
  const query = vehicleStr ? `${partName} ${vehicleStr}` : partName;
  const encoded = encodeURIComponent(query);

  return [
    {
      label: 'RockAuto',
      url: `https://www.rockauto.com/en/partsearch/?romstatus=instock&query=${encoded}`,
      color: '#e8232a',
    },
    {
      label: 'eBay Motors',
      // _sacat=6030 scopes to Motors > Parts & Accessories
      url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&_sacat=6030`,
      color: '#e53238',
    },
    {
      label: 'car-parts.com',
      // car-parts.com search only uses the part name (no vehicle filter in URL)
      url: `https://www.car-parts.com/search?searchTerm=${encodeURIComponent(partName)}`,
      color: '#0057a8',
    },
    {
      label: 'Amazon',
      // TODO: Replace YOUR_AFFILIATE_TAG with your actual Amazon Associates tag
      url: `https://www.amazon.com/s?k=${encoded}&tag=YOUR_AFFILIATE_TAG`,
      color: '#FF9900',
    },
  ];
};
