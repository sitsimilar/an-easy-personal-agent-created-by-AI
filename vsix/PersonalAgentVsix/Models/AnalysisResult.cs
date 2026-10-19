using System.Collections.Generic;
using Newtonsoft.Json;

namespace PersonalAgentVsix.Models
{
    /// <summary>分析结果 DTO（与伴侣导出的 schemaVersion:1 JSON 对齐）。</summary>
    public class AnalysisResult
    {
        [JsonProperty("schemaVersion")]
        public int SchemaVersion { get; set; }

        [JsonProperty("solutionName")]
        public string SolutionName { get; set; }

        [JsonProperty("solutionPath")]
        public string SolutionPath { get; set; }

        [JsonProperty("projectName")]
        public string ProjectName { get; set; }

        [JsonProperty("summary")]
        public string Summary { get; set; }

        [JsonProperty("issues")]
        public List<IssueDto> Issues { get; set; }

        /// <summary>done | failed</summary>
        [JsonProperty("status")]
        public string Status { get; set; }

        [JsonProperty("message")]
        public string Message { get; set; }

        [JsonProperty("analyzedAt")]
        public string AnalyzedAt { get; set; }

        [JsonProperty("issueCount")]
        public int IssueCount { get; set; }
    }

    /// <summary>问题条目 DTO。</summary>
    public class IssueDto
    {
        /// <summary>error | warning | suggestion</summary>
        [JsonProperty("severity")]
        public string Severity { get; set; }

        [JsonProperty("title")]
        public string Title { get; set; }

        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("suggestion")]
        public string Suggestion { get; set; }

        /// <summary>大白话版标题（与 Title 内容一致、仅表达风格不同）。</summary>
        [JsonProperty("titlePlain")]
        public string TitlePlain { get; set; }

        /// <summary>大白话版描述。</summary>
        [JsonProperty("descriptionPlain")]
        public string DescriptionPlain { get; set; }

        /// <summary>大白话版建议。</summary>
        [JsonProperty("suggestionPlain")]
        public string SuggestionPlain { get; set; }

        /// <summary>相对解决方案目录的路径。</summary>
        [JsonProperty("file")]
        public string File { get; set; }

        [JsonProperty("line")]
        public int? Line { get; set; }
    }
}
