"use client";

type OperationLocationMapProps = Readonly<{
  latitude: number;
  longitude: number;
  label: string;
}>;

export function OperationLocationMap({ latitude, longitude, label }: OperationLocationMapProps) {
  const coordinates = `${latitude},${longitude}`;
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY;
  const embedUrl = apiKey
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(coordinates)}&zoom=15`
    : "";

  return (
    <div className="operation-location-map">
      <div className="operation-location-map-heading">
        <strong>{label}</strong>
        <a href={directionsUrl} target="_blank" rel="noreferrer">فتح الموقع في خرائط Google</a>
      </div>
      {embedUrl ? (
        <iframe
          title={`خريطة ${label}`}
          src={embedUrl}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <p role="status">مفتاح خرائط المتصفح غير مُعدّ في بيئة لوحة التحكم. استخدم رابط الموقع أعلاه.</p>
      )}
    </div>
  );
}
