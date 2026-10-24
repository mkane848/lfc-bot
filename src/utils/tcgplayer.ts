/**
 * TCGplayer links and images, built from a product id. The id is all a
 * catalog row needs to store: TCGCSV's own `url` and `imageUrl` fields follow
 * exactly these shapes for every product (`/product/<id>/<slug>` and
 * `/product/<id>_200w.jpg`), so deriving them loses nothing.
 */

/** The marketplace page for a product. TCGplayer routes by id, so the slug is left off. */
export function tcgplayerProductUrl(productId: string | number): string {
  return `https://www.tcgplayer.com/product/${productId}`;
}

/** The product's thumbnail, 200 pixels wide. */
export function tcgplayerImageUrl(productId: string | number): string {
  return `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`;
}
