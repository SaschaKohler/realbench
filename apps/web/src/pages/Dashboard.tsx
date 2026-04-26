import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjects, useCreateProject, useDeleteProject } from '../lib/api';
import Navigation from '../components/layout/Navigation';
import QuotaBanner from '../components/ui/QuotaBanner';

export default function Dashboard() {
  const { data, isLoading } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    language: 'cpp',
  });

  const handleDelete = async () => {
    if (projectToDelete) {
      await deleteProject.mutateAsync(projectToDelete);
      setProjectToDelete(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createProject.mutateAsync(formData);
    setShowCreateForm(false);
    setFormData({ name: '', language: 'cpp' });
  };

  return (
    <div className="min-h-screen bg-gray-900">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <QuotaBanner />
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold text-white">Projects</h2>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            New Project
          </button>
        </div>

        {showCreateForm && (
          <div className="mb-8 bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4">Create New Project</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Project Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Language</label>
                <select
                  value={formData.language}
                  onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                >
                  <option value="cpp">C++</option>
                  <option value="rust">Rust</option>
                  <option value="go">Go</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  disabled={createProject.isPending}
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {projectToDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-semibold mb-4">Delete Project</h3>
              <p className="text-gray-300 mb-6">
                Are you sure you want to delete this project? This will also delete all associated runs. This action cannot be undone.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setProjectToDelete(null)}
                  className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteProject.isPending}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-600"
                >
                  {deleteProject.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data?.projects?.map((project: any) => (
              <div
                key={project.id}
                className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition group relative"
              >
                <Link to={`/projects/${project.id}`} className="block">
                  <h3 className="text-xl font-semibold mb-2 pr-8">{project.name}</h3>
                  <div className="space-y-2">
                    <span className="inline-block px-3 py-1 bg-gray-700 text-sm rounded-full">
                      {project.language.toUpperCase()}
                    </span>
                    <div className="text-xs text-gray-400">
                      <div className="flex items-center gap-2">
                        <span>Project ID:</span>
                        <code 
                          className="bg-gray-700 px-2 py-0.5 rounded font-mono cursor-pointer hover:bg-gray-600"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            navigator.clipboard.writeText(project.id);
                          }}
                          title="Click to copy"
                        >
                          {project.id}
                        </code>
                      </div>
                    </div>
                  </div>
                </Link>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Delete clicked for project:', project.id);
                    setProjectToDelete(project.id);
                  }}
                  className="absolute top-4 right-4 p-2 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition z-10 bg-gray-800 rounded"
                  title="Delete project"
                  type="button"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
