/**
 * Where the nodes are.
 *
 * One marker per location, sized by how many nodes report from it, so a single
 * datacenter running eight nodes reads differently from eight cities running
 * one each — the concentration is the point of the view, and the Location
 * histogram beside it cannot show it.
 *
 * MapLibre over CARTO's vector basemap. This is the one place in the app that
 * talks to a third party: tiles are fetched per view, so the tile host sees the
 * IP of anyone who opens this page. Nothing about a *node* is sent — the
 * request is for map squares, not for our data — but the request happens, and
 * it is the reason this view is lazy-loaded rather than part of the main
 * bundle. Serving a self-hosted basemap instead means changing BASEMAP_STYLE
 * and nothing else.
 */

import { useEffect, useRef } from "react";
import { AttributionControl, Map as MapLibreMap, NavigationControl, Popup } from "maplibre-gl";
import { useEffectiveTheme } from "../../stores/themeStore";
import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import type { MapPoint } from "../../domain/map-points";
import "maplibre-gl/dist/maplibre-gl.css";

interface NodeMapProps {
  points: MapPoint[];
  /** Nodes with no coordinates, stated rather than silently dropped. */
  unplaceable: number;
}

/**
 * CARTO's basemaps, whose two flavours line up with the app's own themes.
 *
 * Keyless and CORS-open, which is what rules out most alternatives: Protomaps
 * publishes no free planet endpoint (self-host or paid API), and MapTiler
 * needs a key in the client.
 */
const BASEMAP_STYLE = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

/**
 * Marker radius from node count, in pixels.
 *
 * Square root, not linear: a marker's *area* is what the eye compares, so a
 * linear radius would make ten nodes look a hundred times one.
 */
function radiusOf(total: number): number {
  return 5 + Math.sqrt(total) * 2.4;
}

/** GeoJSON for the marker layer — the only thing that changes per feed flush. */
function toGeoJson(points: MapPoint[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
      properties: {
        label: point.label,
        total: point.total,
        radius: radiusOf(point.total),
        // Colour is chosen here rather than in the style so the legend and the
        // map cannot disagree about what counts as a validator.
        kind: point.stale === point.total ? "stale" : point.validators > 0 ? "validator" : "rpc",
        tooltip:
          `${point.label} — ${point.total} node${point.total === 1 ? "" : "s"}` +
          (point.validators > 0
            ? `, ${point.validators} validator${point.validators === 1 ? "" : "s"}`
            : "") +
          (point.stale > 0 ? `, ${point.stale} stale` : ""),
      },
    })),
  };
}

/** Read a theme colour as a literal, since MapLibre paints on a canvas. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function NodeMap({ points, unplaceable }: NodeMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const theme = useEffectiveTheme();
  const placed = points.reduce((sum, point) => sum + point.total, 0);

  useEffect(() => {
    if (container.current === null) return;

    const instance = new MapLibreMap({
      container: container.current,
      style: BASEMAP_STYLE[theme],
      center: [10, 25],
      zoom: 1.1,
      // The dashboard is a flat view of where things are; a tilted or turned
      // map makes positions harder to compare and nothing here needs it.
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: false,
      attributionControl: false,
    });

    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: '<a href="https://carto.com/attributions">CARTO</a>',
      }),
      "bottom-right",
    );

    instance.on("load", () => {
      // CARTO ships a street map: continent, city and road names all fight the
      // markers for the same few pixels, and at this zoom none of them help —
      // the question is "where are the nodes", not "what is this place called".
      // Country outlines and the coastline carry all the orientation needed.
      for (const layer of instance.getStyle().layers) {
        if (layer.type !== "symbol") continue;
        if (/^place_country/.test(layer.id)) {
          // Country names stay, dimmed: they orient without competing.
          instance.setPaintProperty(layer.id, "text-opacity", 0.4);
        } else {
          // Continents included — "EUROPE" is set in huge letters right where
          // the densest cluster sits.
          instance.setLayoutProperty(layer.id, "visibility", "none");
        }
      }

      instance.addSource("nodes", { type: "geojson", data: toGeoJson(points) });

      instance.addLayer({
        id: "nodes",
        type: "circle",
        source: "nodes",
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": [
            "match",
            ["get", "kind"],
            "validator",
            cssVar("--color-success"),
            "stale",
            cssVar("--color-warning"),
            cssVar("--color-muted"),
          ],
          "circle-opacity": 0.85,
          // A ring of the page background, so overlapping markers read as two
          // circles rather than one blob.
          "circle-stroke-width": 1.5,
          "circle-stroke-color": cssVar("--color-bg"),
        },
      });

      instance.addLayer({
        id: "node-counts",
        type: "symbol",
        source: "nodes",
        // Only worth printing where it fits; smaller markers have the popup.
        filter: [">=", ["get", "total"], 3],
        layout: {
          "text-field": ["to-string", ["get", "total"]],
          "text-font": ["Open Sans Bold"],
          "text-size": 12,
          // The number belongs to its marker, so it must never be dropped or
          // nudged aside to make room for a basemap label.
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": cssVar("--color-bg"),
          // The marker under the digits is semi-transparent, so a city name can
          // show through; a halo of the marker's own colour keeps them legible.
          "text-halo-color": [
            "match",
            ["get", "kind"],
            "validator",
            cssVar("--color-success"),
            "stale",
            cssVar("--color-warning"),
            cssVar("--color-muted"),
          ],
          "text-halo-width": 1.2,
        },
      });
    });

    const popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      // Themed in components.css; MapLibre's default is a white box.
      className: "node-popup",
      maxWidth: "260px",
    });

    instance.on("mouseenter", "nodes", (event: MapLayerMouseEvent) => {
      instance.getCanvas().style.cursor = "pointer";
      const feature = event.features?.[0];
      if (feature === undefined || feature.geometry.type !== "Point") return;
      const props = feature.properties ?? {};
      popup
        .setLngLat(feature.geometry.coordinates as [number, number])
        // setText, not setHTML: these strings are built from node-reported
        // names, which are attacker-controlled.
        .setText(String(props.tooltip ?? ""))
        .addTo(instance);
    });

    instance.on("mouseleave", "nodes", () => {
      instance.getCanvas().style.cursor = "";
      popup.remove();
    });

    // The container is laid out by CSS after this effect runs, so MapLibre's
    // first size measurement can be stale — and a map that believes it is 0px
    // wide requests no tiles at all and renders blank. Re-measuring once the
    // browser has laid the page out is what makes the basemap appear; the
    // observer then keeps it right through window and breakpoint changes.
    const frame = requestAnimationFrame(() => instance.resize());
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(container.current);

    map.current = instance;
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      popup.remove();
      instance.remove();
      map.current = null;
    };
    // Rebuilt on theme change: the basemap's layers are baked into the style,
    // so swapping flavour means a new style rather than a repaint. Points are
    // deliberately not a dependency — the effect below updates them in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Feed updates move markers without touching the basemap.
  useEffect(() => {
    const source = map.current?.getSource<GeoJSONSource>("nodes");
    source?.setData(toGeoJson(points));
  }, [points]);

  return (
    <section className="glass-card relative overflow-hidden p-4">
      <div className="edge-accent absolute inset-x-0 top-0 h-px" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-sans text-[11px] uppercase tracking-[0.12em] text-muted">Locations</h2>
        <p className="text-xs text-muted">
          {placed} placed
          {unplaceable > 0 && (
            <span title="Cloudflare reported no coordinates for these nodes">
              {" · "}
              {unplaceable} without coordinates
            </span>
          )}
        </p>
      </div>

      <div
        ref={container}
        className="node-map mt-3"
        role="img"
        aria-label={`World map of ${placed} nodes across ${points.length} locations`}
      />

      {points.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          No node reported coordinates. Cloudflare attaches them at the edge, so they are absent
          when the worker runs locally.
        </p>
      )}

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-success opacity-85" />
          Has a validator
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-muted opacity-85" />
          RPC only
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-warning opacity-85" />
          All stale
        </li>
        <li>Marker area is the node count</li>
      </ul>
    </section>
  );
}
