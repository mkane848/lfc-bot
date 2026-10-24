import { vi } from 'vitest';

interface Route {
  status?: number;
  body?: unknown;
  text?: string;
  etag?: string;
  /** Reject like a dropped connection instead of answering. */
  fail?: boolean;
}

export interface RecordedCall {
  path: string;
  headers: Record<string, string>;
}

/**
 * A stand-in for tcgcsv.com. Routes are keyed by path (`/last-updated.txt`,
 * `/tcgplayer/3/groups`, `/tcgplayer/3/23228/products`); a request carrying a
 * matching `If-None-Match` gets a `304`, as the real site does, and every
 * request is recorded so tests can assert on what was asked and how.
 */
export class FakeTcgcsv {
  readonly routes = new Map<string, Route>();
  readonly calls: RecordedCall[] = [];

  set(path: string, route: Route): this {
    this.routes.set(path, route);
    return this;
  }

  remove(path: string): this {
    this.routes.delete(path);
    return this;
  }

  /** Paths requested, in order. */
  get paths(): string[] {
    return this.calls.map((call) => call.path);
  }

  /** Install as the global `fetch`; pair with `vi.unstubAllGlobals()` in `afterEach`. */
  install(): void {
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[name.toLowerCase()] = value;
      }
      this.calls.push({ path: url.pathname, headers });

      const route = this.routes.get(url.pathname);
      if (route?.fail) {
        return Promise.reject(new Error('connection reset'));
      }
      if (!route) {
        return Promise.resolve(new Response('not found', { status: 404 }));
      }
      if (route.etag && headers['if-none-match'] === route.etag) {
        return Promise.resolve(new Response(null, { status: 304 }));
      }
      const status = route.status ?? 200;
      const payload = route.text ?? JSON.stringify(route.body ?? {});
      return Promise.resolve(
        new Response(status === 304 || status === 204 ? null : payload, {
          status,
          headers: route.etag ? { etag: route.etag } : {},
        }),
      );
    });
  }
}

export interface FixtureGroup {
  groupId: number;
  name: string;
  abbreviation?: string;
  isSupplemental?: boolean;
  publishedOn?: string;
}

export interface FixtureProduct {
  productId: number;
  name: string;
  /** TCGCSV's `Number`; leave out for sealed product. */
  number?: string;
}

export function groupsBody(groups: FixtureGroup[]): unknown {
  return {
    totalItems: groups.length,
    success: true,
    errors: [],
    results: groups.map((group) => ({
      categoryId: 3,
      modifiedOn: '2026-10-21T15:44:09.54',
      isSupplemental: false,
      ...group,
    })),
  };
}

export function productsBody(products: FixtureProduct[]): unknown {
  return {
    totalItems: products.length,
    success: true,
    errors: [],
    results: products.map((product) => ({
      productId: product.productId,
      name: product.name,
      cleanName: product.name,
      extendedData: product.number
        ? [{ name: 'Number', displayName: 'Number', value: product.number }]
        : [{ name: 'CardText', displayName: 'Card Text', value: 'text' }],
    })),
  };
}

/** The English Obsidian Flames group, with a booster pack, three cards and one qualified printing. */
export const OBF_GROUP: FixtureGroup = {
  groupId: 23228,
  name: 'SV03: Obsidian Flames',
  abbreviation: 'OBF',
  publishedOn: '2023-08-11T00:00:00',
};

export const OBF_PRODUCTS: FixtureProduct[] = [
  { productId: 501256, name: 'Obsidian Flames Booster Pack' },
  { productId: 509879, name: 'Charizard ex', number: '125/197' },
  { productId: 509880, name: 'Charizard ex (Full Art)', number: '223/197' },
  { productId: 509881, name: 'Pikachu (63)', number: '063/197' },
];

/** A Japanese set, whose product names are English with the number written in. */
export const SV3_GROUP: FixtureGroup = {
  groupId: 23400,
  name: 'SV3: Ruler of the Black Flame',
  abbreviation: 'sv3',
  publishedOn: '2023-07-28T00:00:00',
};

export const SV3_PRODUCTS: FixtureProduct[] = [
  { productId: 520001, name: 'Ruler of the Black Flame Booster Box' },
  { productId: 520002, name: 'Charizard ex - 134/108', number: '134/108' },
];

/** A fake TCGCSV holding one English and one Japanese set. */
export function pokemonFixture(): FakeTcgcsv {
  return new FakeTcgcsv()
    .set('/last-updated.txt', { text: '2026-10-23T20:06:07+0000\n' })
    .set('/tcgplayer/3/groups', { body: groupsBody([OBF_GROUP]) })
    .set('/tcgplayer/85/groups', { body: groupsBody([SV3_GROUP]) })
    .set(`/tcgplayer/3/${OBF_GROUP.groupId}/products`, {
      body: productsBody(OBF_PRODUCTS),
      etag: '"obf-1"',
    })
    .set(`/tcgplayer/85/${SV3_GROUP.groupId}/products`, {
      body: productsBody(SV3_PRODUCTS),
      etag: '"sv3-1"',
    });
}
