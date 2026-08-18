export type LlmMode="godmode"|"local"|"provider"|"none";
export type EligibilityPolicy="dhet"|"custom"|"dhet_or_custom"|"all";
export type EvidenceSource="DHET"|"Crossref"|"OpenAlex"|"DOAJ"|"Publisher"|"LicensedRanking"|"UniversityList";
export type EvidenceItem={source:EvidenceSource;field:string;value:string|number|boolean|null;url?:string;observedAt:string;confidence:number;note?:string};
export type CustomJournalEntry={title?:string;issns:string[];sourceRow?:number};