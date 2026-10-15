/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { brandMark } from "@plane/blocks/brand";
// layouts
import DefaultLayout from "@/layouts/default-layout";
// components
import { MaintenanceMessage } from "./maintenance-message";

export function MaintenanceView() {
  return (
    <DefaultLayout>
      <div className="relative container mx-auto flex h-full w-full max-w-xl flex-col items-center justify-center gap-2 gap-y-6 bg-surface-1 text-center">
        <div className="relative w-full">
          <img src={brandMark} height={192} width={192} alt="SchmidbaurPM" className="mx-auto size-32 object-contain" />
        </div>
        <div className="relative mt-4 flex w-full flex-col gap-4">
          <MaintenanceMessage />
        </div>
      </div>
    </DefaultLayout>
  );
}
