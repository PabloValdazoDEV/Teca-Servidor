const AVAILABLE_CHANNELS = ["PHONE", "EMAIL", "WHATSAPP", "SMS"];
const availableChannelSet = new Set(AVAILABLE_CHANNELS);

function getEnabledChannels(value = process.env.PREFERRED_COMMUNICATION_CHANNELS) {
  if (value === undefined) {
    return [...AVAILABLE_CHANNELS];
  }

  return [
    ...new Set(
      String(value)
        .split(",")
        .map((channel) => channel.trim().toUpperCase())
        .filter((channel) => availableChannelSet.has(channel))
    ),
  ];
}

function isEnabled(channel) {
  return getEnabledChannels().includes(String(channel || "").toUpperCase());
}

module.exports = {
  AVAILABLE_CHANNELS,
  getEnabledChannels,
  isEnabled,
};
