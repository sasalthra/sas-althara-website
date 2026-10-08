/** Public listing shape. beds/baths stay null when a post never named them. */
export type CatalogProperty = {
  id: string;
  title: string;
  price: number | null;
  /** Several prices were listed. `price` is the lowest and the card says يبدأ من. */
  priceFrom?: boolean;
  area: number | null;
  beds: string | null;
  baths: string | null;
  city: string | null;
  address: string | null;
  type: string | null;
  purpose: string | null;
  streetWidth: string | null;
  facade: string | null;
  age: string | null;
  description: string;
  images: string[];
  /** Telegram rows are published. Static catalog rows leave this unset. */
  status?: string;
};
