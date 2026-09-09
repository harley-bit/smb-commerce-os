import { useReducer, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { parseMerchantProfile } from "./src/shell/parseMerchantProfile";
import { SignInScreen } from "./src/auth/SignInScreen";
import { HomeScreen } from "./src/merchant/HomeScreen";
import { ListingDetailScreen } from "./src/merchant/ListingDetailScreen";
import { PlaceholderScreen } from "./src/navigation/PlaceholderScreen";
import { initialNavigationState, navigationReducer } from "./src/navigation/navigationState";
import { CartScreen } from "./src/cart/CartScreen";
import { addLine, createEmptyCart, removeLine, type CartState } from "./src/cart/cartStore";
import { expoCartLineGenerators } from "./src/cart/expoIdGenerators";

/**
 * D137's app shell: no real network call yet (that's the mobile customer
 * flows in later Phase 8 cards), just proof that this shell already speaks
 * `@smb-os/contracts`'s shared Zod schemas instead of a mobile-only copy.
 */
const placeholderProfile = parseMerchantProfile({
  name: "SMB Commerce OS",
  slug: "smb-commerce-os",
  defaultCurrency: "USD",
});
const homeSlug = placeholderProfile.ok ? placeholderProfile.profile.slug : "smb-commerce-os";

/**
 * `docs/cards/D139.md` — replaces D137/D138's single static screen with
 * the navigation stack: `SignIn` until `authClient.signIn` succeeds, then
 * `Home` with no way back onto `SignIn` (a `reset`, not a `push` — see
 * `navigationState.test.ts`'s reset case), and free push/pop between the
 * rest of the core screens from there.
 */
export default function App() {
  const [state, dispatch] = useReducer(navigationReducer, undefined, initialNavigationState);
  const [cart, setCart] = useState<CartState>(createEmptyCart);

  if (state.current.name === "SignIn") {
    return (
      <View style={styles.container}>
        <SignInScreen onSignedIn={() => dispatch({ type: "reset", screen: { name: "Home", params: { slug: homeSlug } } })} />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (state.current.name === "Home") {
    const { slug } = state.current.params;
    return (
      <View style={styles.container}>
        <HomeScreen
          slug={slug}
          onSelectListing={(listing) =>
            dispatch({ type: "push", screen: { name: "ListingDetail", params: { slug, listingSlug: listing.slug } } })
          }
          onViewOrders={() => dispatch({ type: "push", screen: { name: "AccountOrders", params: { slug } } })}
        />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (state.current.name === "ListingDetail") {
    const { slug, listingSlug } = state.current.params;
    return (
      <View style={styles.container}>
        <ListingDetailScreen
          slug={slug}
          listingSlug={listingSlug}
          canGoBack={state.stack.length > 0}
          onGoBack={() => dispatch({ type: "goBack" })}
          onBuy={(variant) => {
            setCart((current) =>
              addLine(
                current,
                {
                  mode: "PRODUCT",
                  slug,
                  listingSlug,
                  variantId: variant.id,
                  name: variant.name,
                  unitPriceMinor: variant.priceMinor,
                  currency: variant.currency,
                },
                expoCartLineGenerators,
                new Date(),
              ),
            );
            dispatch({ type: "push", screen: { name: "Cart", params: { slug } } });
          }}
          onBook={() => dispatch({ type: "push", screen: { name: "Checkout", params: { slug } } })}
          onReserveRental={(variant, startDate, endDate) => {
            setCart((current) =>
              addLine(
                current,
                {
                  mode: "RENTAL",
                  slug,
                  listingSlug,
                  variantId: variant.id,
                  name: variant.name,
                  unitPriceMinor: variant.priceMinor,
                  currency: variant.currency,
                  startsAt: `${startDate}T00:00:00.000Z`,
                  endsAt: `${endDate}T00:00:00.000Z`,
                },
                expoCartLineGenerators,
                new Date(),
              ),
            );
            dispatch({ type: "push", screen: { name: "Cart", params: { slug } } });
          }}
        />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (state.current.name === "Cart") {
    const { slug } = state.current.params;
    return (
      <View style={styles.container}>
        <CartScreen
          cart={cart}
          canGoBack={state.stack.length > 0}
          onGoBack={() => dispatch({ type: "goBack" })}
          onRemoveLine={(lineId) => setCart((current) => removeLine(current, lineId))}
          onCheckout={() => dispatch({ type: "push", screen: { name: "Checkout", params: { slug } } })}
        />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PlaceholderScreen
        screen={state.current}
        canGoBack={state.stack.length > 0}
        onGoBack={() => dispatch({ type: "goBack" })}
        onNavigate={(screen) => dispatch({ type: "push", screen })}
      />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
});
