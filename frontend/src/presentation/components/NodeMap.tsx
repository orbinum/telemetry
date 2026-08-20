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

import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  config as maplibreConfig,
} from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { LoadingState } from "./ui/EmptyState";
import { useEffectiveTheme } from "../../stores/themeStore";
import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import type { MapPoint } from "../../domain/map-points";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * MapLibre decodes vector tiles in a Web Worker it loads itself, resolving
 * `./maplibre-gl-worker.mjs` against its own module URL. Nothing imports that
 * file, so the bundler never emits it, and the request lands on `/assets/` with
 * no such asset behind it — which Pages answers with the SPA fallback:
 *
 *   Failed to load module script: The server responded with a non-JavaScript
 *   MIME type of "text/html".
 *
 * A map that cannot decode tiles stops requesting them, so the failure shows up
 * as a blank basemap rather than an error on the page.
 *
 * The import is what makes the file reachable: it is a static reference, so the
 * worker is emitted and hashed like any other asset, and `WORKER_URL` hands
 * MapLibre the built path instead of its own guess. Set before any Map is
 * constructed, since the worker pool is spun up with the first instance.
 *
 * `?worker&url` and not a plain `?url`: the worker is itself an ES module that
 * imports `./maplibre-gl-shared.mjs`, and `?url` copies only the file named,
 * leaving that sibling unemitted. The worker then loads, fails its own import,
 * and dies — with no error on the page, because a map whose worker is gone
 * simply stops requesting tiles and renders an empty basemap. `?worker` bundles
 * the dependency in, so the emitted file stands alone.
 */
maplibreConfig.WORKER_URL = maplibreWorkerUrl;

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
  const [ready, setReady] = useState(false);
  const placed = points.reduce((sum, point) => sum + point.total, 0);

  useEffect(() => {
    if (container.current === null) return;
    setReady(false);

    const instance = new MapLibreMap({
      container: container.current,
      style: BASEMAP_STYLE[theme],
      center: [10, 25],
      zoom: 1.1,
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
      for (const layer of instance.getStyle().layers) {
        if (layer.type !== "symbol") continue;
        if (/^place_country/.test(layer.id)) {
          instance.setPaintProperty(layer.id, "text-opacity", 0.4);
        } else {
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
          "circle-stroke-width": 1.5,
          "circle-stroke-color": cssVar("--color-bg"),
        },
      });

      instance.addLayer({
        id: "node-counts",
        type: "symbol",
        source: "nodes",
        filter: [">=", ["get", "total"], 3],
        layout: {
          "text-field": ["to-string", ["get", "total"]],
          "text-font": ["Open Sans Bold"],
          "text-size": 12,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": cssVar("--color-bg"),
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

      setReady(true);
    });

    instance.on("error", () => setReady(true));

    const popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
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
        .setText(String(props.tooltip ?? ""))
        .addTo(instance);
    });

    instance.on("mouseleave", "nodes", () => {
      instance.getCanvas().style.cursor = "";
      popup.remove();
    });

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
  }, [theme]);

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

      <div className="relative mt-3">
        <div
          ref={container}
          className="node-map"
          role="img"
          aria-busy={!ready}
          aria-label={`World map of ${placed} nodes across ${points.length} locations`}
        />

        {!ready && (
          <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
            <LoadingState>Loading map…</LoadingState>
          </div>
        )}
      </div>

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
