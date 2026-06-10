"use client";

import { UniversalFormDetailData } from "./types";
import { QuickMetricsGrid } from "./QuickMetricsGrid";
import { ComplaintCard } from "./ComplaintCard";
import { FormAnswersSection } from "./FormAnswersSection";
import { TechMetadataAccordion } from "./TechMetadataAccordion";

interface FormDetailViewerProps {
  data: UniversalFormDetailData;
}

export function FormDetailViewer({ data }: FormDetailViewerProps) {
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* 1. Quick Metrics Grid */}
      <QuickMetricsGrid
        submittedAt={data.source.submittedAt}
        platform={data.source.platform}
        phone={data.identity.primaryPhone}
        countryName={data.identity.country?.name}
        countryFlag={data.identity.country?.flag}
        isCountryEstimated={data.identity.country?.isEstimated}
      />

      {/* 2. Complaint & Treatment Expectation Card */}
      <ComplaintCard
        complaint={data.content.complaint}
        appointmentPreference={data.content.appointmentPreference}
        reportStatus={data.content.reportStatus}
        department={data.content.department}
      />

      {/* 3. Operational Form Answers */}
      <FormAnswersSection answers={data.content.userAnswers} />

      {/* 4. Collapsible Tech Metadata & UTM Accordion */}
      <TechMetadataAccordion metadata={data.content.techMetadata} />
    </div>
  );
}
