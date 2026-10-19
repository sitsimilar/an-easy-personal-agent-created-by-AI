using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using PersonalAgentVsix.Models;

namespace PersonalAgentVsix.Services
{
    public class IndexEntry
    {
        [JsonProperty("solutionName")]
        public string SolutionName { get; set; }

        [JsonProperty("file")]
        public string File { get; set; }

        [JsonProperty("analyzedAt")]
        public string AnalyzedAt { get; set; }
    }

    public class IndexFile
    {
        [JsonProperty("version")]
        public int Version { get; set; }

        [JsonProperty("solutions")]
        public Dictionary<string, IndexEntry> Solutions { get; set; }
    }

    public interface IAnalysisFileService
    {
        string BaseDir { get; }

        /// <summary>按当前 solutionPath 读 index → analyses\&lt;slug&gt;.json；未命中回退 latest。</summary>
        AnalysisResult GetLatestForSolution(string solutionPath);

        /// <summary>读 latest-analysis.json（兜底）。</summary>
        AnalysisResult GetLatestOverall();
    }

    public class AnalysisFileService : IAnalysisFileService
    {
        public string BaseDir { get; }

        public AnalysisFileService()
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            BaseDir = Path.Combine(
                string.IsNullOrEmpty(localAppData) ? Path.GetTempPath() : localAppData,
                "PersonalAgent");
        }

        private static string SlugOf(string solutionPath)
        {
            using (var sha1 = SHA1.Create())
            {
                var bytes = sha1.ComputeHash(Encoding.UTF8.GetBytes(solutionPath ?? string.Empty));
                var sb = new StringBuilder();
                for (int i = 0; i < 8; i++) sb.Append(bytes[i].ToString("x2"));
                return sb.ToString();
            }
        }

        public AnalysisResult GetLatestForSolution(string solutionPath)
        {
            if (string.IsNullOrEmpty(solutionPath)) return null;

            var index = ReadIndex();
            if (index?.Solutions != null && index.Solutions.TryGetValue(solutionPath, out var entry))
            {
                var file = Path.Combine(BaseDir, "analyses", entry.File);
                if (File.Exists(file)) return ReadResult(file);
            }

            // 精确匹配失败（路径大小写/未命中）→ 兜底最近一次
            return GetLatestOverall();
        }

        public AnalysisResult GetLatestOverall()
        {
            var file = Path.Combine(BaseDir, "latest-analysis.json");
            return File.Exists(file) ? ReadResult(file) : null;
        }

        private IndexFile ReadIndex()
        {
            try
            {
                var path = Path.Combine(BaseDir, "index.json");
                if (!File.Exists(path)) return null;
                return JsonConvert.DeserializeObject<IndexFile>(File.ReadAllText(path));
            }
            catch
            {
                return null;
            }
        }

        private AnalysisResult ReadResult(string path)
        {
            try
            {
                return JsonConvert.DeserializeObject<AnalysisResult>(File.ReadAllText(path));
            }
            catch
            {
                throw new FormatException("分析结果文件格式异常，请重新分析");
            }
        }
    }
}
