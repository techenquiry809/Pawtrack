//
//  PawTrack — Record Seizure widget
//
//  ── WHAT IT IS ──────────────────────────────────────────────────────
//
//  One tap, from the home screen or the lock screen, that opens PawTrack
//  straight into a running seizure timer. It holds no state and never
//  refreshes: the whole widget is a button with a URL on it.
//
//  ── WHY THERE IS NO TIMELINE ────────────────────────────────────────
//
//  WidgetKit budgets refreshes, and a widget that asks to be woken competes
//  for that budget with widgets that actually change. This one draws the same
//  thing forever, so it returns a single entry with `.never` — costing the
//  system nothing and, more to the point, never being unavailable because a
//  budget ran out at the moment it was needed.
//
//  It deliberately does NOT show the elapsed time of a seizure in progress,
//  which would be the obvious next feature. That would need an App Group and
//  a shared container written to from React Native on every tick, and a
//  widget refresh that WidgetKit is free to delay by minutes. A timer that is
//  sometimes wrong is worse on this screen than no timer at all — the live
//  screen is the source of truth for elapsed time, and it is one tap away.
//
//  ── THE URL ─────────────────────────────────────────────────────────
//
//  `pawtrack://seizure/start` — the scheme comes from app.config.ts and the
//  path is app/seizure/start.tsx, which marks the clock and forwards to the
//  live screen. Do not point this at /seizure/live: that screen shows a timer,
//  it does not start one. See the comment at the top of that route.
//
//  Note the URL is baked in when the widget is RENDERED, not when it is
//  tapped, which is why it cannot carry a tap timestamp.
//

import SwiftUI
import WidgetKit

private let kStartSeizureURL = URL(string: "pawtrack://seizure/start")!

// MARK: - Timeline

struct SeizureEntry: TimelineEntry {
  let date: Date
}

struct SeizureProvider: TimelineProvider {
  func placeholder(in context: Context) -> SeizureEntry {
    SeizureEntry(date: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (SeizureEntry) -> Void) {
    completion(SeizureEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SeizureEntry>) -> Void) {
    // One entry, never reloaded. See the note at the top on why.
    completion(Timeline(entries: [SeizureEntry(date: Date())], policy: .never))
  }
}

// MARK: - Background

/// iOS 17 requires widget backgrounds to go through `containerBackground`, and
/// silently drops anything painted the old way — a widget that looks right in
/// the simulator on 16 and renders white on a real 17 device. iOS 16 has no
/// such modifier, so both paths exist and neither is optional.
private extension View {
  @ViewBuilder
  func widgetBackground<B: View>(_ background: B) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(for: .widget) { background }
    } else {
      self.background(background)
    }
  }
}

private var seizureGradient: LinearGradient {
  LinearGradient(
    colors: [Color("$widgetBackground"), Color("$widgetBackgroundDeep")],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
  )
}

// MARK: - Home screen

/// The record ring: the same shape the app puts in the tab bar, so the widget
/// and the button it stands in for are recognisably the same control.
private struct RecordRing: View {
  var diameter: CGFloat = 46

  var body: some View {
    ZStack {
      Circle()
        .stroke(Color.white.opacity(0.55), lineWidth: 3)
      Circle()
        .fill(Color.white)
        .padding(7)
    }
    .frame(width: diameter, height: diameter)
  }
}

struct SeizureSmallView: View {
  var body: some View {
    ZStack(alignment: .topTrailing) {
      // A paw, quietly, so the widget reads as PawTrack's and not as a
      // generic record button sitting on someone's home screen.
      Image(systemName: "pawprint.fill")
        .font(.system(size: 34))
        .foregroundColor(.white.opacity(0.16))
        .offset(x: 6, y: -4)

      VStack(alignment: .leading, spacing: 0) {
        RecordRing()
        Spacer(minLength: 8)
        Text("Seizure")
          .font(.system(size: 19, weight: .heavy, design: .rounded))
          .foregroundColor(.white)
        Text("Tap to start timer")
          .font(.system(size: 12, weight: .medium, design: .rounded))
          .foregroundColor(.white.opacity(0.85))
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
    .widgetBackground(seizureGradient)
    .widgetURL(kStartSeizureURL)
  }
}

// MARK: - Lock screen
//
// The most valuable placement this widget has: reachable without unlocking,
// which is the state the phone is in when a seizure starts. Accessory families
// are rendered by the system as a monochrome vibrant stencil — colour and
// opacity are ignored, so these views are drawn as shapes only.

struct SeizureCircularView: View {
  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      Image(systemName: "pawprint.circle.fill")
        .font(.system(size: 26))
    }
    .widgetURL(kStartSeizureURL)
  }
}

struct SeizureRectangularView: View {
  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "pawprint.fill")
        .font(.system(size: 16))
      VStack(alignment: .leading, spacing: 1) {
        Text("Seizure")
          .font(.headline)
        Text("Tap to start timer")
          .font(.caption)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(kStartSeizureURL)
  }
}

// MARK: - Entry point

struct SeizureWidgetEntryView: View {
  @Environment(\.widgetFamily) var family
  var entry: SeizureProvider.Entry

  var body: some View {
    switch family {
    case .accessoryCircular:
      SeizureCircularView()
    case .accessoryRectangular:
      SeizureRectangularView()
    default:
      SeizureSmallView()
    }
  }
}

struct SeizureWidget: Widget {
  let kind: String = "SeizureWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: SeizureProvider()) { entry in
      SeizureWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Record Seizure")
    .description("Starts the seizure timer in PawTrack with one tap.")
    // systemSmall only on the home screen. A medium or large tile would be
    // the same single button stretched across half a screen, and the whole
    // point is that it is small enough to sit next to the clock.
    .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    // Deliberately NOT .contentMarginsDisabled(): it is an iOS 17 API, this
    // target deploys to 16, and a WidgetConfiguration modifier cannot be put
    // behind `if #available` the way a View modifier can — the two branches
    // return different opaque types and will not compile. The default margins
    // inset the CONTENT only; `containerBackground` still paints edge to edge.
  }
}

@main
struct SeizureWidgetBundle: WidgetBundle {
  var body: some Widget {
    SeizureWidget()
  }
}
