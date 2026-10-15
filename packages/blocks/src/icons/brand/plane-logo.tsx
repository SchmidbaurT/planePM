/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";
import { brandMark } from "../../brand";

export type PlaneLogoProps = React.ComponentPropsWithoutRef<"svg">;

export function PlaneLogo({ width = "52", height = "52", className }: PlaneLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 192 192"
      role="img"
      aria-label="SchmidbaurPM"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <image href={brandMark} width="192" height="192" />
    </svg>
  );
}
