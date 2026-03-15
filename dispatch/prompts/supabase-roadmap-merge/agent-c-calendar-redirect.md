# Agent C: Convert calendar.html to Redirect

**File:** `C:/Users/ColsonR/apstats-live-worksheet/calendar.html`
**Method:** CC-direct
**Depends on:** Agent A verified (roadmap accepts `?period=` param)

## Change

Replace the entire file with a lightweight redirect that preserves the `?period=` param:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Redirecting to AP Statistics Calendar...</title>
<script>
  var params = new URLSearchParams(window.location.search);
  var period = (params.get('period') || 'B').toUpperCase();
  if (period !== 'B' && period !== 'E') period = 'B';
  window.location.replace('ap_stats_roadmap_square_mode.html?period=' + period);
</script>
</head>
<body>
<p>Redirecting to <a href="ap_stats_roadmap_square_mode.html">AP Statistics Calendar</a>...</p>
</body>
</html>
```

This preserves existing bookmarks and Schoology link references during the transition.
