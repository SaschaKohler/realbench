import { Link, useLocation } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';

const navigation = [
  { name: 'Dashboard', href: '/' },
  { name: 'Settings', href: '/settings' },
];

export default function Navigation() {
  const location = useLocation();

  return (
    <nav className="border-b border-gray-800 bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-2xl font-bold text-white hover:text-gray-300">
              RealBench
            </Link>
            <div className="hidden md:flex space-x-6">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`text-sm transition ${
                    location.pathname === item.href
                      ? 'text-white font-medium'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    </nav>
  );
}
