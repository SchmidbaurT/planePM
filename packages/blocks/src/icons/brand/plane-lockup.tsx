/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";
import { brandLogo } from "../../brand";

export type PlaneLockupProps = React.ComponentPropsWithoutRef<"svg">;

export function PlaneLockup({ width = "134", height = "40", className }: PlaneLockupProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 711 212"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="SchmidbaurPM"
    >
      <image href={brandLogo} width="711" height="212" />
    </svg>
  );
}
