bool browserUserAgentLooksLikeTablet({
  required String userAgent,
  required String platformName,
  required int maxTouchPoints,
}) {
  if (maxTouchPoints < 2) return false;
  final agent = userAgent.toLowerCase();
  final devicePlatform = platformName.toLowerCase();
  final iPad =
      agent.contains('ipad') ||
      (devicePlatform == 'macintel' && maxTouchPoints > 1);
  final androidTablet = agent.contains('android') && !agent.contains('mobile');
  return iPad || androidTablet;
}
