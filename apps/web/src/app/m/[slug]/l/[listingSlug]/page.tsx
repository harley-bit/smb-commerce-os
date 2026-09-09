"use client";

import { useParams } from "next/navigation";
import { ProductDetailView } from "./ProductDetailView";

export default function ProductDetailPage() {
  const params = useParams<{ slug: string; listingSlug: string }>();
  return <ProductDetailView slug={params.slug} listingSlug={params.listingSlug} />;
}
