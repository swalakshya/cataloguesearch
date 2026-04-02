import React from 'react';
import { Link } from 'react-router-dom';
import { getAllStats } from '../utils/searchableContent.js';

const SearchableContentWidget = () => {
  const stats = getAllStats();

  return (
    <div className="flex items-stretch gap-3 mb-4">
      {/* Pravachans stat card */}
      <div className="flex-1 flex items-center gap-2.5 bg-gradient-to-br from-sky-50 to-sky-100 border border-sky-200 rounded-md px-3 py-2">
        <span className="text-xl leading-none">🎙️</span>
        <div>
          <div className="text-xl font-bold text-sky-700 leading-none">{stats.pravachan.grandTotal.toLocaleString()}</div>
          <div className="text-xs text-sky-600 font-medium mt-0.5">Pravachans</div>
        </div>
      </div>

      {/* Granths stat card */}
      <div className="flex-1 flex items-center gap-2.5 bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 rounded-md px-3 py-2">
        <span className="text-xl leading-none">📜</span>
        <div>
          <div className="text-xl font-bold text-amber-700 leading-none">{stats.granth.searchable}</div>
          <div className="text-xs text-amber-600 font-medium mt-0.5">Granths</div>
        </div>
      </div>

      {/* Browse All button */}
      <Link
        to="/search-index"
        className="flex items-center px-3 py-2 bg-white border border-slate-200 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-sky-600 hover:border-sky-200 transition-all duration-200 whitespace-nowrap"
      >
        Browse All →
      </Link>
    </div>
  );
};

export default SearchableContentWidget;
