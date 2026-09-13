import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface ReverseGeocodeResponse {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const { coordinates } = (await request.json()) as { coordinates?: string };
    const match = coordinates?.match(
      /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/,
    );
    if (!match) {
      return NextResponse.json({ error: "Invalid coordinates." }, { status: 400 });
    }

    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: "Coordinates are out of range." }, { status: 400 });
    }

    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=10`,
      {
        headers: { "User-Agent": "Jarvis local assistant location lookup" },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error("Reverse-geocoding request failed.");

    const data = (await response.json()) as ReverseGeocodeResponse;
    const address = data.address || {};
    const locality =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county;
    const location = [locality, address.state, address.country]
      .filter(Boolean)
      .join(", ");

    return NextResponse.json({ location });
  } catch {
    return NextResponse.json(
      { error: "Could not resolve the current location." },
      { status: 502 },
    );
  }
}
