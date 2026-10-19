using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using PersonalAgentVsix.Models;
using PersonalAgentVsix.Services;

namespace PersonalAgentVsix
{
    /// <summary>
    /// 工具窗口界面：读取本地分析结果并展示（摘要 + 着色问题列表 + 跳转）。
    /// </summary>
    public partial class AnalysisToolWindowControl : UserControl
    {
        private readonly IAnalysisFileService _fileService = new AnalysisFileService();
        private readonly SolutionService _solutionService = new SolutionService();
        private readonly EditorNavigationService _navigationService = new EditorNavigationService();
        private AnalysisResult _result;

        public AnalysisToolWindowControl()
        {
            InitializeComponent();
            LoadAnalysis();
        }

        private void RefreshButton_Click(object sender, RoutedEventArgs e)
        {
            LoadAnalysis();
        }

        private bool PlainMode => PlainRadio != null && PlainRadio.IsChecked == true;

        private void Wording_Checked(object sender, RoutedEventArgs e)
        {
            // 切换措辞风格：重新渲染当前结果
            if (_result != null) RenderResult(_result);
        }

        private void LoadAnalysis()
        {
            try
            {
                string solutionPath = _solutionService.CurrentSolutionPath();
                if (string.IsNullOrEmpty(solutionPath))
                {
                    ShowState("当前未打开解决方案", null);
                    return;
                }

                var result = _fileService.GetLatestForSolution(solutionPath);
                if (result == null)
                {
                    ShowState("暂无分析结果。请在桌面伴侣中完成一次 VS 分析", null);
                    return;
                }

                if (string.Equals(result.Status, "failed", StringComparison.OrdinalIgnoreCase))
                {
                    var message = string.IsNullOrEmpty(result.Message) ? "分析失败" : "分析失败：" + result.Message;
                    ShowState(message, result);
                    return;
                }

                _result = result;
                RenderResult(result);
            }
            catch (FormatException)
            {
                ShowState("分析结果文件格式异常，请重新分析", null);
            }
            catch (Exception)
            {
                ShowState("读取分析结果失败，请稍后重试", null);
            }
        }

        private void ShowState(string message, AnalysisResult result)
        {
            _result = result;
            EmptyText.Text = message;
            EmptyText.Visibility = Visibility.Visible;
            ResultPanel.Visibility = Visibility.Collapsed;
            SetStatus(result);
        }

        private void RenderResult(AnalysisResult result)
        {
            EmptyText.Visibility = Visibility.Collapsed;
            ResultPanel.Visibility = Visibility.Visible;

            SummaryText.Text = string.IsNullOrEmpty(result.Summary) ? "（无摘要）" : result.Summary;
            MetaText.Text = FormatMeta(result);

            var items = new List<IssueItem>();
            if (result.Issues != null)
            {
                foreach (var issue in result.Issues)
                {
                    items.Add(new IssueItem(issue, PlainMode));
                }
            }
            IssueList.ItemsSource = items;
            SetStatus(result);
        }

        private void SetStatus(AnalysisResult result)
        {
            if (result == null)
            {
                StatusText.Text = string.Empty;
                return;
            }
            StatusText.Text = result.IssueCount > 0 ? result.IssueCount + " 个建议" : "无建议";
        }

        private static string FormatMeta(AnalysisResult result)
        {
            var parts = new List<string>();
            if (!string.IsNullOrEmpty(result.SolutionName)) parts.Add("解决方案：" + result.SolutionName);
            if (!string.IsNullOrEmpty(result.AnalyzedAt)) parts.Add("分析时间：" + FormatTime(result.AnalyzedAt));
            return string.Join(" · ", parts);
        }

        private static string FormatTime(string iso)
        {
            if (DateTime.TryParse(iso, out var dt))
            {
                return dt.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
            }
            return iso;
        }

        private void Issue_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            var item = (sender as FrameworkElement)?.DataContext as IssueItem;
            if (item == null || _result == null || !item.CanNavigate) return;
            _navigationService.OpenAndGoto(_result.SolutionPath, item.File, item.Line);
        }
    }

    /// <summary>问题条目视图模型（供 XAML 绑定）。</summary>
    public class IssueItem
    {
        public string Severity { get; }
        public string SeverityLabel { get; }
        public string Title { get; }
        public string Description { get; }
        public string SuggestionText { get; }
        public string Location { get; }
        public bool CanNavigate { get; }
        public string File { get; }
        public int? Line { get; }

        public IssueItem(IssueDto issue, bool plain)
        {
            Severity = issue.Severity ?? "suggestion";
            SeverityLabel = LabelOf(Severity);

            var title = plain ? FirstNonEmpty(issue.TitlePlain, issue.Title) : issue.Title;
            var desc = plain ? FirstNonEmpty(issue.DescriptionPlain, issue.Description) : issue.Description;
            var sugg = plain ? FirstNonEmpty(issue.SuggestionPlain, issue.Suggestion) : issue.Suggestion;

            Title = string.IsNullOrEmpty(title) ? "（无标题）" : title;
            Description = desc ?? string.Empty;
            SuggestionText = string.IsNullOrEmpty(sugg) ? string.Empty : "建议：" + sugg;
            File = issue.File;
            Line = issue.Line;
            CanNavigate = !string.IsNullOrEmpty(issue.File);
            Location = CanNavigate
                ? issue.File + (issue.Line.HasValue && issue.Line.Value > 0 ? ":" + issue.Line.Value : string.Empty)
                : string.Empty;
        }

        /// <summary>大白话版缺失时回退专业版。 </summary>
        private static string FirstNonEmpty(string preferred, string fallback)
        {
            return !string.IsNullOrEmpty(preferred) ? preferred : fallback;
        }

        private static string LabelOf(string severity)
        {
            switch (severity)
            {
                case "error": return "必须修复";
                case "warning": return "建议修复";
                case "suggestion": return "可优化";
                default: return "提示";
            }
        }
    }
}
