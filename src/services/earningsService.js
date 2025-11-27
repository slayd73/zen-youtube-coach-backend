export function estimateEarnings(video) {
  const RPM = 1.2; // valore medio
  const earnings = (video.views / 1000) * RPM;

  return {
    estimatedRPM: RPM,
    estimatedEarnings: earnings.toFixed(2) + " €"
  };
}
