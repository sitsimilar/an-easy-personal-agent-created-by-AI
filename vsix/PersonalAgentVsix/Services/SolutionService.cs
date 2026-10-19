using EnvDTE;
using Microsoft.VisualStudio.Shell;

namespace PersonalAgentVsix.Services
{
    /// <summary>获取当前解决方案路径（DTE.Solution.FullName）。</summary>
    public class SolutionService
    {
        public string CurrentSolutionPath()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var dte = ServiceProvider.GlobalProvider.GetService(typeof(DTE)) as DTE;
            var solution = dte?.Solution;
            if (solution == null || string.IsNullOrEmpty(solution.FullName))
            {
                return null;
            }
            return solution.FullName;
        }
    }
}
