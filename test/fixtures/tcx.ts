export const simpleRunTcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="Running">
      <Id>2026-03-10T06:00:00Z</Id>
      <Lap>
        <TotalTimeSeconds>1800</TotalTimeSeconds>
        <DistanceMeters>5000</DistanceMeters>
        <Calories>300</Calories>
        <AverageHeartRateBpm><Value>150</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>170</Value></MaximumHeartRateBpm>
      </Lap>
      <Lap>
        <TotalTimeSeconds>1860</TotalTimeSeconds>
        <DistanceMeters>5100</DistanceMeters>
        <Calories>305</Calories>
        <AverageHeartRateBpm><Value>154</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>173</Value></MaximumHeartRateBpm>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

export const invalidTcx = `<TrainingCenterDatabase><Activities></Activities></TrainingCenterDatabase>`;
