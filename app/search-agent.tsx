'use client';
import {useEffect} from 'react';

type Item = {id: string; title: string; price: number | null; address: string | null; city: string | null};
type Context = {registerTool: (tool: {name: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => unknown}, options: {signal: AbortSignal}) => void | Promise<void>};

export default function SearchAgent({onSearch, properties}: {onSearch: (q: string) => void; properties: Item[]}) {
  useEffect(() => {
    const ctx = (document as Document & {modelContext?: Context}).modelContext;
    if (!ctx) return;
    const life = new AbortController();
    try {
      Promise.resolve(ctx.registerTool({
        name: 'search_properties',
        description: 'Search the property catalog and show matching cards on the page.',
        inputSchema: {type: 'object', properties: {query: {type: 'string', maxLength: 100}}, required: ['query'], additionalProperties: false},
        annotations: {readOnlyHint: false, untrustedContentHint: true},
        execute(input) {
          if (!input || typeof input !== 'object' || !('query' in input) || typeof input.query !== 'string' || input.query.length > 100) throw new Error('Invalid query');
          onSearch(input.query);
          const query = input.query;
          return {matches: properties.filter(item => (item.title + (item.address ?? '') + (item.city ?? '')).includes(query)).map(item => ({id: item.id, title: item.title, price: item.price}))};
        },
      }, {signal: life.signal})).catch(() => {});
    } catch {
      /* The page still searches without the optional model tool. */
    }
    return () => life.abort();
  }, [onSearch, properties]);
  return null;
}
