import { Composition } from "remotion";
import { attendanceCorrectionScenario } from "./scenarios/attendance-correction";
import { clockInScenario } from "./scenarios/clock-in";
import { clockOutScenario } from "./scenarios/clock-out";
import { hourlyWageRuleBulkEditScenario } from "./scenarios/hourly-wage-rule-bulk-edit";
import { TutorialVideo } from "./tutorial-video";

const scenarios = [
  clockInScenario,
  clockOutScenario,
  attendanceCorrectionScenario,
  hourlyWageRuleBulkEditScenario,
];

export const Root = () => (
  <>
    {scenarios.map((scenario) => (
      <Composition
        key={scenario.id}
        id={scenario.id}
        component={TutorialVideo}
        durationInFrames={scenario.durationInFrames}
        fps={30}
        width={540}
        height={1170}
        defaultProps={{ scenario }}
      />
    ))}
  </>
);
