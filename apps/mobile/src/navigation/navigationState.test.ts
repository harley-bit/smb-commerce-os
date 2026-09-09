import { describe, expect, it } from "vitest";
import { initialNavigationState, navigationReducer } from "./navigationState.js";

describe("navigationReducer — mobile navigation stack (D139)", () => {
  it("starts on the SignIn screen with an empty back stack", () => {
    const state = initialNavigationState();
    expect(state.current).toEqual({ name: "SignIn", params: {} });
    expect(state.stack).toEqual([]);
  });

  it("push moves the current screen onto the stack and navigates to the new one", () => {
    const start = initialNavigationState();
    const afterSignIn = navigationReducer(start, {
      type: "reset",
      screen: { name: "Home", params: { slug: "corner-bike-shop" } },
    });

    const afterPush = navigationReducer(afterSignIn, {
      type: "push",
      screen: { name: "ListingDetail", params: { slug: "corner-bike-shop", listingSlug: "trail-bike" } },
    });

    expect(afterPush.current).toEqual({
      name: "ListingDetail",
      params: { slug: "corner-bike-shop", listingSlug: "trail-bike" },
    });
    expect(afterPush.stack).toEqual([{ name: "Home", params: { slug: "corner-bike-shop" } }]);
  });

  it("goBack pops the stack and restores the previous screen", () => {
    const home = initialNavigationState();
    const afterReset = navigationReducer(home, {
      type: "reset",
      screen: { name: "Home", params: { slug: "corner-bike-shop" } },
    });
    const pushed = navigationReducer(afterReset, {
      type: "push",
      screen: { name: "ListingDetail", params: { slug: "corner-bike-shop", listingSlug: "trail-bike" } },
    });

    const back = navigationReducer(pushed, { type: "goBack" });

    expect(back.current).toEqual({ name: "Home", params: { slug: "corner-bike-shop" } });
    expect(back.stack).toEqual([]);
  });

  it("goBack on an empty stack is a no-op — never navigates past the root screen", () => {
    const start = initialNavigationState();
    const back = navigationReducer(start, { type: "goBack" });
    expect(back).toEqual(start);
  });

  it("reset replaces the whole stack, discarding history (used for the sign-in -> home transition)", () => {
    const start = initialNavigationState();
    const pushed = navigationReducer(start, {
      type: "push",
      screen: { name: "Home", params: { slug: "corner-bike-shop" } },
    });

    const reset = navigationReducer(pushed, {
      type: "reset",
      screen: { name: "SignIn", params: {} },
    });

    expect(reset).toEqual({ current: { name: "SignIn", params: {} }, stack: [] });
  });
});
