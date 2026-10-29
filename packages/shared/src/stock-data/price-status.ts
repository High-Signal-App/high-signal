import status from './price-status.json';

export function stockPriceDisplayStatus() {
  return { ...status, permitted: status.publicDisplay === 'permitted' };
}
