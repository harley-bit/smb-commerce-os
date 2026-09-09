/**
 * `docs/cards/D139.md` — the mobile app's core screens, named to mirror
 * `apps/web/src/app/m/[slug]`'s route structure 1:1 (`MerchantPageView` →
 * `Home`, `l/[listingSlug]` → `ListingDetail`, `checkout` → `Checkout`,
 * `checkout/confirmation` → `OrderConfirmation`, `account/orders` →
 * `AccountOrders`) plus `SignIn`, which has no web-storefront equivalent
 * (merchant staff auth, not a customer route). D140+ wire real screens to
 * these names; this card only establishes the shape they navigate through.
 *
 * `Cart` (`docs/cards/D145.md`) is the one screen with no web counterpart
 * at all, not even an unmirrored path the way `SignIn` has `/login`: the
 * storefront's `CartService` has no HTTP route yet (`docs/cards/D142.md`'s
 * log), so there is nothing on web to point at. `toWebPath` below maps it
 * onto the checkout route it feeds into rather than inventing a URL no web
 * page answers.
 */
export type ScreenName = "SignIn" | "Home" | "ListingDetail" | "Cart" | "Checkout" | "OrderConfirmation" | "AccountOrders";

export type ScreenParams = {
  SignIn: Record<string, never>;
  Home: { slug: string };
  ListingDetail: { slug: string; listingSlug: string };
  Cart: { slug: string };
  Checkout: { slug: string };
  OrderConfirmation: { slug: string; orderId: string };
  AccountOrders: { slug: string };
};

export type Screen = {
  [Name in ScreenName]: { name: Name; params: ScreenParams[Name] };
}[ScreenName];

/** The web path this screen mirrors — same route structure, so parity is checkable, not just asserted. */
export function toWebPath(screen: Screen): string {
  switch (screen.name) {
    case "SignIn":
      return "/login";
    case "Home":
      return `/m/${screen.params.slug}`;
    case "ListingDetail":
      return `/m/${screen.params.slug}/l/${screen.params.listingSlug}`;
    case "Cart":
      return `/m/${screen.params.slug}/checkout`;
    case "Checkout":
      return `/m/${screen.params.slug}/checkout`;
    case "OrderConfirmation":
      return `/m/${screen.params.slug}/checkout/confirmation`;
    case "AccountOrders":
      return `/m/${screen.params.slug}/account/orders`;
  }
}
