"use client";

import { useParams } from "next/navigation";
import { MerchantPageView } from "./MerchantPageView";

export default function MerchantPage() {
  const params = useParams<{ slug: string }>();
  return <MerchantPageView slug={params.slug} />;
}
