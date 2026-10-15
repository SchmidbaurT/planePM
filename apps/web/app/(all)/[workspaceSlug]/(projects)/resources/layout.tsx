import { Outlet } from "react-router";
import { Wrench } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Header } from "@plane/blocks/layout";
import { Breadcrumbs } from "@plane/blocks/breadcrumb";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";

export default function ResourcesLayout() {
  const { t } = useTranslation();
  return <><AppHeader header={<Header><Header.LeftItem><Breadcrumbs><Breadcrumbs.Item component={<BreadcrumbLink label={t("planning.resources")} icon={<Wrench size={16} />} />} /></Breadcrumbs></Header.LeftItem></Header>} /><ContentWrapper><Outlet /></ContentWrapper></>;
}