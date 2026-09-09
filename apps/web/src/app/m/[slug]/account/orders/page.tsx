"use client";

import { useParams } from "next/navigation";
import { OrderHistoryView } from "./OrderHistoryView";

/** `docs/cards/D132.md` — routed at `/m/[slug]/account/orders`. */
export default function OrderHistoryPage() {
  const params = useParams<{ slug: string }>();
  return <OrderHistoryView slug={params.slug} />;
}
